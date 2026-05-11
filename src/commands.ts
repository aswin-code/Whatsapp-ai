import { store } from './store';
import { contacts, parseAddCommand } from './contacts';
import { sendMessage } from './whatsapp';

export async function handleOwnerCommand(command: string): Promise<string> {
  const trimmed = command.trim();

  // ── Draft management ────────────────────────────────────────────────────────

  if (/^(status|list)$/i.test(trimmed)) {
    const drafts = store.list();
    if (drafts.length === 0) return 'No pending drafts.';
    return drafts.map(d => {
      const contact = contacts.get(d.to);
      const label = contact ? `${contact.name} (${d.to})` : d.to;
      return `#${d.id} → ${label}\nReceived: "${truncate(d.originalMessage, 80)}"\nDraft: "${truncate(d.suggestedReply, 80)}"`;
    }).join('\n\n');
  }

  const sendMatch = trimmed.match(/^SEND\s+(\d+)$/i);
  if (sendMatch) {
    const id = parseInt(sendMatch[1], 10);
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    await sendMessage(draft.to, draft.suggestedReply);
    store.remove(id);
    const name = contacts.get(draft.to)?.name ?? draft.to;
    return `Sent to ${name}:\n"${draft.suggestedReply}"`;
  }

  const editMatch = trimmed.match(/^EDIT\s+(\d+)\s+(.+)$/i);
  if (editMatch) {
    const id = parseInt(editMatch[1], 10);
    const newText = editMatch[2].trim();
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    await sendMessage(draft.to, newText);
    store.remove(id);
    const name = contacts.get(draft.to)?.name ?? draft.to;
    return `Sent to ${name}:\n"${newText}"`;
  }

  const skipMatch = trimmed.match(/^SKIP\s+(\d+)$/i);
  if (skipMatch) {
    const id = parseInt(skipMatch[1], 10);
    const draft = store.get(id);
    if (!draft) return `No draft #${id} found.`;
    store.remove(id);
    const name = contacts.get(draft.to)?.name ?? draft.to;
    return `Skipped #${id} (${name}) — no reply sent.`;
  }

  // ── Contact management ──────────────────────────────────────────────────────

  // ADD <number> <name> <relationship> [notes]
  const addMatch = trimmed.match(/^ADD\s+(.+)$/i);
  if (addMatch) {
    const result = parseAddCommand(addMatch[1]);
    if (typeof result === 'string') return result;
    contacts.set(result);
    return `Saved contact:\n👤 ${result.name} (${result.number})\nRelationship: ${result.relationship}${result.notes ? `\nNotes: ${result.notes}` : ''}\nAuto-reply: ${result.neverAutoReply ? 'off' : 'on'} | Always escalate: ${result.alwaysEscalate ? 'yes' : 'no'}`;
  }

  // CONTACTS — list all saved contacts
  if (/^contacts$/i.test(trimmed)) {
    const list = contacts.list();
    if (list.length === 0) return 'No contacts saved yet.\nUse: ADD <number> <name> <relationship>';
    return '📒 Contacts:\n\n' + list.map(c =>
      `${c.name} — ${c.number}\n  ${c.relationship}${c.notes ? ` · ${c.notes}` : ''}`
    ).join('\n\n');
  }

  // WHO <number> — show a contact's profile
  const whoMatch = trimmed.match(/^WHO\s+(\d+)$/i);
  if (whoMatch) {
    const c = contacts.get(whoMatch[1]);
    if (!c) return `No contact found for ${whoMatch[1]}.`;
    return `👤 ${c.name}\nNumber: ${c.number}\nRelationship: ${c.relationship}\nNotes: ${c.notes || '—'}\nAuto-reply: ${c.neverAutoReply ? 'off' : 'on'}\nAlways escalate: ${c.alwaysEscalate ? 'yes' : 'no'}`;
  }

  // REMOVE <number> — delete a contact
  const removeMatch = trimmed.match(/^REMOVE\s+(\d+)$/i);
  if (removeMatch) {
    const num = removeMatch[1];
    const c = contacts.get(num);
    if (!c) return `No contact found for ${num}.`;
    contacts.remove(num);
    return `Removed ${c.name} (${num}).`;
  }

  // ── Initiate conversation ───────────────────────────────────────────────────

  // MSG <number|name> <text> — send a message to any contact
  const msgMatch = trimmed.match(/^MSG\s+(\S+)\s+(.+)$/i);
  if (msgMatch) {
    const target = msgMatch[1];
    const text = msgMatch[2].trim();

    // Allow using name or number
    let number = target.replace(/\D/g, '');
    if (!number) {
      const found = contacts.list().find(c => c.name.toLowerCase() === target.toLowerCase());
      if (!found) return `Contact "${target}" not found. Use number or saved name.`;
      number = found.number;
    }

    const contactName = contacts.get(number)?.name ?? number;
    await sendMessage(number, text);
    return `Sent to ${contactName}:\n"${text}"`;
  }

  // ── Help ────────────────────────────────────────────────────────────────────
  return [
    'Available commands:',
    '',
    'Drafts:',
    '  STATUS — list pending drafts',
    '  SEND <n> — send draft #n as-is',
    '  EDIT <n> <text> — send custom reply for draft #n',
    '  SKIP <n> — discard draft #n without replying',
    '',
    'Contacts:',
    '  ADD <number> <name> <relationship> [notes]',
    '  CONTACTS — list all contacts',
    '  WHO <number> — view contact profile',
    '  REMOVE <number> — delete contact',
    '',
    'Messaging:',
    '  MSG <number or name> <text> — send a message',
    '',
    'Relationships: close_friend, family, colleague, client, acquaintance',
  ].join('\n');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
