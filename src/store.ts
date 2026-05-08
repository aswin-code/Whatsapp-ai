import { Draft } from './types';

class DraftStore {
  private drafts = new Map<number, Draft>();
  private counter = 0;

  add(to: string, suggestedReply: string, originalMessage: string): Draft {
    const id = ++this.counter;
    const draft: Draft = { id, to, suggestedReply, originalMessage, timestamp: new Date() };
    this.drafts.set(id, draft);
    return draft;
  }

  get(id: number): Draft | undefined {
    return this.drafts.get(id);
  }

  remove(id: number): boolean {
    return this.drafts.delete(id);
  }

  list(): Draft[] {
    return Array.from(this.drafts.values()).sort((a, b) => a.id - b.id);
  }
}

export const store = new DraftStore();
