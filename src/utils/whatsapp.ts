/**
 * WhatsApp Business Cloud API (Meta) — proactive template messages.
 * No-op until WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are configured, so it
 * ships safely and turns on once the Meta WhatsApp account is set up.
 */

const GRAPH_VERSION = 'v21.0';

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Normalize a stored phone to E.164 without the leading '+', e.g. "919876543210".
 * Strips spaces, dashes, parens, and a leading '+'/'00'. If the number doesn't
 * already start with a country code, prepend the default (India '91').
 */
export function normalizeWhatsAppPhone(
  phone: string,
  defaultCC = process.env.WHATSAPP_DEFAULT_CC || '91',
): string {
  let d = (phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/\D/g, '');

  // Indian mobile numbers are 10 digits; prepend CC if missing.
  if (d.length === 10) d = `${defaultCC}${d}`;
  // 11 digits starting with 0 (national format) → drop the 0, prepend CC.
  else if (d.length === 11 && d.startsWith('0')) d = `${defaultCC}${d.slice(1)}`;

  return d;
}

/**
 * Send a pre-approved template message. Returns the Meta message id (wamid) on
 * success so the caller can correlate delivery/read webhooks, or null if not configured.
 * Throws on a non-OK API response.
 */
export async function sendWhatsAppTemplate(
  toPhone: string,
  bodyParams: string[],
  templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'loan_followup',
  lang = process.env.WHATSAPP_LANG || 'en',
): Promise<string | null> {
  if (!isWhatsAppConfigured()) return null;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: lang },
        components: [
          {
            type: 'body',
            parameters: bodyParams.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  }

  const data: any = await res.json();
  return data?.messages?.[0]?.id ?? null;
}
