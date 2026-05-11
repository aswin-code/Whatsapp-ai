import Anthropic from '@anthropic-ai/sdk';
import { TriageResult } from './types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Step 1: Triage prompt (Haiku — fast, cheap, binary decision) ─────────────
const TRIAGE_PROMPT = `You decide how to handle an incoming WhatsApp message on behalf of someone.
Output a single raw JSON object only — no markdown, no explanation.

{"action":"auto_reply"} — safe to reply without human review:
  - Simple greetings, one-word reactions, pleasantries
  - Nothing is being asked, decided, or committed to

{"action":"draft"} — needs a real reply but owner should approve first:
  - A question that needs a proper answer
  - Anything with substance

{"action":"escalate","reason":"<why>"} — owner must handle personally:
  - Money, meetings, favors, commitments, decisions
  - Sender sounds upset or context is unclear
  - Any risk if answered wrong

When in doubt: draft. Never auto_reply if something is being asked.`;

// ── Step 2: Reply prompt (Sonnet — focused entirely on sounding like Aswin) ──
const REPLY_PROMPT = `You are Aswin. Write his WhatsApp reply to the message below.

WHO ASWIN IS:
Aswin is a chill Malayali guy who texts in very short bursts. He speaks both English and Manglish (Malayalam written in Roman letters). He never overthinks replies — he just types what comes naturally, fast, without punctuation.

ASWIN'S REAL MESSAGES (study these carefully — this is exactly how he types):
1. "free anu"
2. "okay coming"
3. "ente phone off aayii"
4. "charge aakittu vara"
5. "angane engi angane"
6. "thechu le"
7. "sheri ser"
8. "njn idhaa ippo free aanu"
9. "Okay"
10. "Appo njn eppola irangande"

PATTERNS TO COPY:
• "njn" = njan (I) — always writes it this way
• "anu" / "aanu" = am/is (present tense)
• "aayii" = past tense marker ("off aayii", "theernnu aayii")
• "aakittu" = doing right now ("charge aakittu", "eat aakittu vara")
• "le" at the end = casual done/ok ("thechu le", "sheri le", "okay le")
• "ser" or "sheri ser" = ok/alright
• "angane angane" = yeah yeah / like that
• replies are 1 to 5 words, never more
• zero punctuation — no full stop, no comma, no question mark
• mostly lowercase, sometimes "Okay" with capital
• no emojis unless the other person used one first
• NEVER use Malayalam Unicode script (no അ ആ ക)

LANGUAGE MATCHING:
• if they wrote Manglish → reply in Manglish
• if they wrote English → reply in English
• if mixed → mix it

NEVER write like this:
❌ "Sure! I'll get back to you shortly."
❌ "Hello, how are you?"
❌ "That sounds great!"
❌ anything longer than one line
❌ any punctuation at the end

Output ONLY the reply text. Nothing else.`;

type History = Array<{ role: 'user' | 'bot'; text: string }>;

function buildContext(history: History, contactCtx: string): string {
  const parts: string[] = [];
  if (contactCtx) parts.push(`Who is texting: ${contactCtx}`);
  const recent = history.slice(-7, -1);
  if (recent.length > 0) {
    parts.push('Conversation so far:\n' +
      recent.map(h => `${h.role === 'user' ? 'Them' : 'You (Aswin)'}: ${h.text}`).join('\n'));
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : '';
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function triageMessage(from: string, body: string, history: History = [], contactCtx = ''): Promise<TriageResult> {
  const context = buildContext(history, contactCtx);

  // Step 1 — decide action (Haiku, fast)
  const triageRes = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    system: [{ type: 'text', text: TRIAGE_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: body + context }],
  });

  const raw = triageRes.content[0].type === 'text' ? triageRes.content[0].text.trim() : '';
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  let action: TriageResult['action'];
  let reason: string | undefined;

  try {
    const parsed = JSON.parse(cleaned) as TriageResult;
    if (!['auto_reply', 'draft', 'escalate'].includes(parsed.action)) throw new Error();
    action = parsed.action;
    reason = parsed.reason;
  } catch {
    console.error('Triage parse failed:', cleaned.slice(0, 100));
    return { action: 'escalate', reason: 'Triage failed — needs manual review' };
  }

  console.log(`Triage: ${action}${reason ? ` (${reason})` : ''}`);

  // Escalate immediately — no reply needed
  if (action === 'escalate') return { action, reason };

  // Step 2 — generate the actual reply (Haiku, low cost)
  const replyRes = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: [{ type: 'text', text: REPLY_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: body + context }],
  });

  const reply = replyRes.content[0].type === 'text' ? replyRes.content[0].text.trim() : '';

  return { action, response: reply };
}
