import axios from 'axios';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export async function sendMessage(to: string, body: string): Promise<void> {
  const { WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = process.env;
  await axios.post(
    `${GRAPH_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

export interface ParsedMessage {
  from: string;
  text: string;
  messageId: string;
}

// Extracts the first text message from a Meta webhook POST body.
// Returns null for status updates, non-text messages, and malformed payloads.
export function parseIncomingMessage(body: unknown): ParsedMessage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    const message = b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') return null;
    return {
      from: String(message.from),
      text: String(message.text.body),
      messageId: String(message.id),
    };
  } catch {
    return null;
  }
}
