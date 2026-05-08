/**
 * Analyzes a WhatsApp chat export and writes a personalized OWNER PERSONA
 * block into src/brain.ts based on how you actually type.
 *
 * How to export your chat:
 *   WhatsApp → Open any chat → ⋮ Menu → More → Export chat → Without media
 *
 * Usage:
 *   npm run analyze -- --file ~/Downloads/WhatsApp\ Chat.txt --owner "Your Name"
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const filePath = get('--file');
const ownerName = get('--owner');

if (!filePath || !ownerName) {
  console.error('Usage: npm run analyze -- --file <export.txt> --owner "<Your Name in Chat>"');
  console.error('\nHow to export: WhatsApp → chat → ⋮ → More → Export chat → Without media');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

// ── Parse WhatsApp export ─────────────────────────────────────────────────────
interface ChatMessage {
  sender: string;
  body: string;
}

function parseExport(content: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Matches both iOS and Android export formats:
  // iOS:     [01/05/2024, 3:45:12 PM] Name: text
  // Android: 01/05/2024, 15:45 - Name: text
  // Android: 5/1/24, 3:45 pm - Name: text
  const headerRegex =
    /^(?:\[[\d/]+,\s[\d:]+(?:\s?[AaPp][Mm])?\]\s|[\d/]+,\s[\d:]+(?:\s?[AaPp][Mm])?\s-\s)(.+?):\s(.+)$/;

  let current: ChatMessage | null = null;

  for (const line of content.split('\n')) {
    const m = line.match(headerRegex);
    if (m) {
      if (current) messages.push(current);
      current = { sender: m[1].trim(), body: m[2].trim() };
    } else if (current && line.trim()) {
      current.body += ' ' + line.trim();
    }
  }
  if (current) messages.push(current);

  return messages;
}

const SKIP_PATTERNS = [
  /^<.+omitted>$/i,
  /image omitted/i,
  /video omitted/i,
  /audio omitted/i,
  /sticker omitted/i,
  /document omitted/i,
  /This message was deleted/i,
  /You deleted this message/i,
  /missed (voice|video) call/i,
];

function isSkippable(body: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(body.trim()));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nReading ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const all = parseExport(content);

  const ownerLower = ownerName.toLowerCase();
  const ownerMessages = all
    .filter((m) => m.sender.toLowerCase() === ownerLower && !isSkippable(m.body))
    .map((m) => m.body);

  if (ownerMessages.length === 0) {
    console.error(
      `No messages found for "${ownerName}". ` +
        `Check the name matches exactly as it appears in the chat export.`
    );
    console.error(
      '\nSenders found in this export:',
      [...new Set(all.map((m) => m.sender))].join(', ')
    );
    process.exit(1);
  }

  console.log(`Found ${ownerMessages.length} messages from "${ownerName}"`);

  // Sample up to 150 messages spread across the export for variety
  const sample = sampleEvenly(ownerMessages, 150);
  console.log(`Analyzing ${sample.length} sampled messages with Claude...\n`);

  // ── Ask Claude to analyze the style ──────────────────────────────────────
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are analyzing WhatsApp messages to build a persona profile for an AI that will reply on this person's behalf.

Here are ${sample.length} real messages sent by this person:

${sample.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Analyze these and produce a persona block in EXACTLY this format (fill in every section with real observations):

---PERSONA START---
Name: ${ownerName}
Language: [English / Manglish / Mixed — describe what they use and when]
Tone: [2-3 sentence description of their overall vibe]
Typical message length: [very short / short / medium — with examples]
Capitalisation: [do they use uppercase? when?]
Punctuation habits: [do they use full stops? commas? ellipses? question marks?]
Emoji usage: [which ones, how often, in what context]
Signature phrases: [list 5-10 words or phrases they use often]
Manglish words they use: [list any Malayalam-in-English words found, or "none detected"]
What they sound like: [write 3-4 example replies in their voice for: a greeting, a casual chat, saying they're busy, agreeing to something]
---PERSONA END---

Only output the block between the markers. No explanation.`,
      },
    ],
  });

  const analysis =
    response.content[0].type === 'text' ? response.content[0].text.trim() : '';

  const personaMatch = analysis.match(/---PERSONA START---([\s\S]+?)---PERSONA END---/);
  if (!personaMatch) {
    console.error('Claude returned an unexpected format. Raw output:\n', analysis);
    process.exit(1);
  }

  const persona = personaMatch[1].trim();

  // ── Print the result ──────────────────────────────────────────────────────
  console.log('━'.repeat(60));
  console.log('ANALYSIS COMPLETE\n');
  console.log(persona);
  console.log('━'.repeat(60));

  // ── Patch brain.ts ────────────────────────────────────────────────────────
  const brainPath = path.join(__dirname, '..', 'src', 'brain.ts');
  let brain = fs.readFileSync(brainPath, 'utf-8');

  const personaBlockRegex = /OWNER PERSONA\n[\s\S]+?(?=`)/;
  const newBlock = `OWNER PERSONA\n${persona}\n`;

  if (personaBlockRegex.test(brain)) {
    brain = brain.replace(personaBlockRegex, newBlock);
    fs.writeFileSync(brainPath, brain, 'utf-8');
    console.log('\n✓ src/brain.ts updated with your persona.');
    console.log('  Review it, tweak anything that feels off, then restart the bot.\n');
  } else {
    console.log('\nCould not auto-patch brain.ts — paste the block above into the OWNER PERSONA section manually.\n');
  }
}

function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
