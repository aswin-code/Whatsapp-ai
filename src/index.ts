import 'dotenv/config';
import express, { Request, Response } from 'express';
import { parseIncomingMessage, sendMessage } from './whatsapp';
import { triageMessage } from './brain';
import { store } from './store';
import { handleOwnerCommand } from './commands';

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
  // Owner commands are processed locally — no triage needed
  if (OWNER && from === OWNER) {
    const reply = await handleOwnerCommand(text);
    await sendMessage(OWNER, reply);
    return;
  }

  // All other senders go through Claude triage
  const history = histories.get(from) ?? [];
  let triage;
  try {
    triage = await triageMessage(from, text, history);
  } catch (err) {
    console.error('Claude triage error:', err);
    await sendMessage(
      OWNER,
      `⚠️ Triage error for message from ${from}.\nMessage: "${text}"\nError: ${String(err)}`
    ).catch(console.error);
    return;
  }

  console.log(`Triage result for ${from}: ${triage.action}`);

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
        `📝 Draft #${draft.id} for ${from}\n\n` +
          `Received:\n"${text}"\n\n` +
          `Suggested reply:\n"${draft.suggestedReply}"\n\n` +
          `SEND ${draft.id}  |  EDIT ${draft.id} <text>  |  SKIP ${draft.id}`
      );
      break;
    }

    case 'escalate':
      await sendMessage(
        OWNER,
        `🚨 ESCALATE from ${from}\n\n` +
          `Message:\n"${text}"\n\n` +
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
