export type TriageAction = 'auto_reply' | 'draft' | 'escalate';

export interface TriageResult {
  action: TriageAction;
  response?: string;
  reason?: string;
}

export interface Draft {
  id: number;
  to: string;
  suggestedReply: string;
  originalMessage: string;
  timestamp: Date;
}
