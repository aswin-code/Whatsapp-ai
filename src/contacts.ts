import fs from 'fs';
import path from 'path';

export type Relationship = 'close_friend' | 'family' | 'colleague' | 'client' | 'acquaintance' | 'unknown';

export interface Contact {
  number: string;
  name: string;
  relationship: Relationship;
  notes: string;         // free text: "childhood friend", "my manager", etc.
  alwaysEscalate: boolean; // e.g. boss, client — never auto-reply
  neverAutoReply: boolean; // draft everything for review
}

const DB_PATH = path.join(__dirname, '..', 'contacts.json');

function load(): Map<string, Contact> {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as Contact[];
      return new Map(raw.map(c => [c.number, c]));
    }
  } catch {}
  return new Map();
}

function save(contacts: Map<string, Contact>) {
  fs.writeFileSync(DB_PATH, JSON.stringify([...contacts.values()], null, 2));
}

class ContactStore {
  private contacts = load();

  get(number: string): Contact | undefined {
    return this.contacts.get(number);
  }

  set(contact: Contact) {
    this.contacts.set(contact.number, contact);
    save(this.contacts);
  }

  remove(number: string): boolean {
    const deleted = this.contacts.delete(number);
    if (deleted) save(this.contacts);
    return deleted;
  }

  list(): Contact[] {
    return [...this.contacts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Returns a short context string for the brain prompt
  context(number: string): string {
    const c = this.contacts.get(number);
    if (!c) return 'Unknown contact — no profile set.';
    return `Contact: ${c.name} | Relationship: ${c.relationship}${c.notes ? ` | Notes: ${c.notes}` : ''}`;
  }
}

export const contacts = new ContactStore();

// ── Parse "ADD" command ───────────────────────────────────────────────────────
// Format: ADD <number> <name> <relationship> [notes]
// Example: ADD 919876543210 Kaveri close_friend childhood friend very close
export function parseAddCommand(args: string): Contact | string {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 3) {
    return 'Usage: ADD <number> <name> <relationship> [notes]\n' +
      'Relationships: close_friend, family, colleague, client, acquaintance\n' +
      'Example: ADD 919876543210 Kaveri close_friend childhood bestie';
  }

  const [number, name, rel, ...noteParts] = parts;
  const validRels: Relationship[] = ['close_friend', 'family', 'colleague', 'client', 'acquaintance', 'unknown'];
  const relationship = validRels.includes(rel as Relationship) ? rel as Relationship : 'unknown';

  return {
    number: number.replace(/\D/g, ''),
    name,
    relationship,
    notes: noteParts.join(' '),
    alwaysEscalate: relationship === 'client',
    neverAutoReply: relationship === 'client' || relationship === 'colleague',
  };
}
