import 'dotenv/config';
import express, { Request, Response } from 'express';
import { parseIncomingMessage, sendMessage } from './whatsapp';
import { triageMessage } from './brain';
import { store } from './store';
import { handleOwnerCommand } from './commands';
import { contacts } from './contacts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? '3000';
const OWNER = (process.env.OWNER_NUMBER ?? '').replace(/\D/g, '');

// Keep last 10 messages per sender so the bot understands conversation context
const histories = new Map<string, Array<{ role: 'user' | 'bot'; text: string }>>();

function addToHistory(from: string, role: 'user' | 'bot', text: string) {
  const h = histories.get(from) ?? [];
  h.push({ role, text });
  if (h.length > 10) h.shift();
  histories.set(from, h);
}

// Talk mode — owner is directly chatting with a specific contact through the bot
// talkTarget = the contact's number the owner is currently talking to
let talkTarget: string | null = null;

// ── Health check ────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.send('WhatsApp AI bot is running');
});

// ── Webhook verification (Meta calls this when you save the webhook URL) ────
app.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified by Meta');
    res.status(200).send(challenge);
  } else {
    console.warn('Webhook verification failed — check WEBHOOK_VERIFY_TOKEN');
    res.sendStatus(403);
  }
});

// ── Incoming messages ────────────────────────────────────────────────────────
app.post('/webhook', (req: Request, res: Response) => {
  // Acknowledge immediately — Meta requires a 200 within 5 seconds
  res.sendStatus(200);

  const msg = parseIncomingMessage(req.body);
  if (!msg) return;

  const { from, text } = msg;
  const ts = new Date().toISOString();
  console.log(`[${ts}] Message from ${from}: ${text}`);

  addToHistory(from, 'user', text);

  // Process asynchronously so we never block the response
  processMessage(from, text).catch((err) =>
    console.error(`[${ts}] Unhandled error processing message from ${from}:`, err)
  );
});

async function processMessage(from: string, text: string): Promise<void> {
  // ── Owner messages ──────────────────────────────────────────────────────────
  if (OWNER && from === OWNER) {

    // TALK <name/number> — enter conversation mode
    const talkMatch = text.trim().match(/^TALK\s+(.+)$/i);
    if (talkMatch) {
      const target = talkMatch[1].trim();
      let number = target.replace(/\D/g, '');
      if (!number) {
        const found = contacts.list().find(c => c.name.toLowerCase() === target.toLowerCase());
        if (!found) { await sendMessage(OWNER, `Contact "${target}" not found.`); return; }
        number = found.number;
      }
      talkTarget = number;
      const name = contacts.get(number)?.name ?? number;
      await sendMessage(OWNER, `💬 Talk mode ON — chatting as you with ${name}\nEvery message you send goes to them.\nSend ENDTALK to stop.`);
      return;
    }

    // ENDTALK — exit conversation mode
    if (/^ENDTALK$/i.test(text.trim())) {
      if (!talkTarget) { await sendMessage(OWNER, 'No active talk session.'); return; }
      const name = contacts.get(talkTarget)?.name ?? talkTarget;
      talkTarget = null;
      await sendMessage(OWNER, `Talk mode OFF — stopped chatting with ${name}`);
      return;
    }

    // In talk mode — forward message directly to the contact
    if (talkTarget) {
      await sendMessage(talkTarget, text);
      addToHistory(talkTarget, 'bot', text);
      return;
    }

    // Normal owner command
    const reply = await handleOwnerCommand(text);
    await sendMessage(OWNER, reply);
    return;
  }

  // If owner is in talk mode with this contact, forward reply directly to owner
  if (talkTarget === from) {
    const name = contacts.get(from)?.name ?? from;
    await sendMessage(OWNER, `💬 ${name}: ${text}`);
    addToHistory(from, 'user', text);
    return;
  }

  // All other senders go through Claude triage
  const history = histories.get(from) ?? [];
  const contact = contacts.get(from);
  const contactCtx = contacts.context(from);
  const contactLabel = contact ? `${contact.name} (${from})` : from;

  // Hard overrides based on contact profile — skip Claude entirely
  if (contact?.alwaysEscalate) {
    await sendMessage(OWNER,
      `🚨 ESCALATE from ${contactLabel}\n\n"${text}"\n\nReason: Always escalate for ${contact.relationship}`
    ).catch(console.error);
    return;
  }

  let triage;
  try {
    triage = await triageMessage(from, text, history, contactCtx);
  } catch (err) {
    console.error('Claude triage error:', err);
    await sendMessage(
      OWNER,
      `⚠️ Triage error for message from ${contactLabel}.\nMessage: "${text}"\nError: ${String(err)}`
    ).catch(console.error);
    return;
  }

  // Per-contact overrides
  if (contact?.neverAutoReply && triage.action === 'auto_reply') {
    triage = { ...triage, action: 'draft' };
  }
  // autoReplyAll: send even drafts without asking, only escalate goes to owner
  if (contact?.autoReplyAll && triage.action === 'draft') {
    triage = { ...triage, action: 'auto_reply' };
  }

  console.log(`Triage result for ${contactLabel}: ${triage.action}`);

  switch (triage.action) {
    case 'auto_reply':
      if (triage.response) {
        await sendMessage(from, triage.response);
        addToHistory(from, 'bot', triage.response);
      }
      break;

    case 'draft': {
      const draft = store.add(from, triage.response ?? '', text);
      await sendMessage(
        OWNER,
        `📝 Draft #${draft.id} from ${contactLabel}\n\n` +
          `"${text}"\n\n` +
          `Suggested:\n"${draft.suggestedReply}"\n\n` +
          `SEND ${draft.id}  |  EDIT ${draft.id} <text>  |  SKIP ${draft.id}`
      );
      break;
    }

    case 'escalate':
      await sendMessage(
        OWNER,
        `🚨 ESCALATE from ${contactLabel}\n\n` +
          `"${text}"\n\n` +
          `Reason: ${triage.reason ?? 'Needs your attention'}`
      );
      break;
  }
}

app.listen(Number(PORT), () => {
  console.log(`Server listening on :${PORT}`);
  if (!OWNER) {
    console.warn('WARNING: OWNER_NUMBER is not set — owner commands disabled');
  }
});
