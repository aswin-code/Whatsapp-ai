import { store } from './store';
import { sendMessage } from './whatsapp';

// Parses and executes a command sent by the owner via WhatsApp.
// Returns a confirmation string to send back to the owner.
export async function handleOwnerCommand(command: string): Promise<string> {
  const trimmed = command.trim();

  // STATUS / LIST — show all pending drafts
  if (/^(status|list)$/i.test(trimmed)) {
    const drafts = store.list();
    if (drafts.length === 0) return 'No pending drafts.';
    return drafts
      .map(
        (d) =>
          `#${d.id} → ${d.to}\n` +
          `Received: "${truncate(d.originalMessage, 80)}"\n` +
          `Draft: "${truncate(d.suggestedReply, 80)}"`
      )
      .join('\n\n');
  }

  // SEND <id> — send the draft as-is
  const sendMatch = trimmed.match(/^SEND\s+(\d+)$/i);
  if (sendMatch) {
    const id = parseInt(sendMatch[1], 10);
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    await sendMessage(draft.to, draft.suggestedReply);
    store.remove(id);
    return `Sent to ${draft.to}:\n"${draft.suggestedReply}"`;
  }

  // EDIT <id> <new text> — send a custom reply instead
  const editMatch = trimmed.match(/^EDIT\s+(\d+)\s+(.+)$/i);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    const newText = editMatch[2].trim();
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    await sendMessage(draft.to, newText);
    store.remove(id);
    return `Sent edited reply to ${draft.to}:\n"${newText}"`;
  }

  // SKIP <id> — discard the draft without replying
  const skipMatch = trimmed.match(/^SKIP\s+(\d+)$/i);
  if (skipMatch) {
    const id = parseInt(skipMatch[1], 10);
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    store.remove(id);
    return `Skipped #${id} (${draft.to}) — no reply sent.`;
  }

  return (
    'Unknown command.\n\n' +
    'Available commands:\n' +
    '  STATUS — list pending drafts\n' +
    '  SEND <n> — send draft #n as-is\n' +
    '  EDIT <n> <text> — send custom reply for draft #n\n' +
    '  SKIP <n> — discard draft #n without replying'
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
