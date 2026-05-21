/**
 * Meta Conversions API (CAPI) — server-side event forwarding.
 * Complements the browser pixel for better signal quality, ad-blocker bypass,
 * and improved event match quality.
 *
 * Pixel ID : 914655691586718
 * Env var  : META_ACCESS_TOKEN  (from Events Manager → Pixel → Settings → Conversions API)
 */

import crypto from 'crypto';

const PIXEL_ID      = '914655691586718';
const CAPI_ENDPOINT = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash a string after lower-casing and trimming (Meta requirement). */
function hash(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Strip everything except digits from a phone number. */
function normalizePhone(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  // If Indian number without country code, prepend 91
  return digits.startsWith('91') ? digits : `91${digits}`;
}

/** Unix seconds. */
function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapiUserData {
  email?:          string;
  phone?:          string;
  firstName?:      string;
  lastName?:       string;
  clientIp?:       string;
  clientUserAgent?: string;
  /** _fbp cookie value from the browser (passed through request) */
  fbp?:            string;
  /** _fbc cookie value from the browser */
  fbc?:            string;
}

export interface CapiEvent {
  eventName:       string;        // 'Lead' | 'CompleteRegistration' | 'Subscribe' | 'Purchase' etc.
  eventId?:        string;        // for deduplication with browser pixel
  eventSourceUrl?: string;
  userData:        CapiUserData;
  customData?: Record<string, unknown>;
}

// ─── Main send function ────────────────────────────────────────────────────────

export async function sendCapiEvent(event: CapiEvent): Promise<void> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    // Silently skip if not configured — doesn't break anything
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Meta CAPI] META_ACCESS_TOKEN not set — skipping event:', event.eventName);
    }
    return;
  }

  const { userData } = event;

  const payload = {
    data: [
      {
        event_name:        event.eventName,
        event_time:        unixNow(),
        event_id:          event.eventId,
        action_source:     'website',
        event_source_url:  event.eventSourceUrl ?? 'https://biddaro.com',
        user_data: {
          // Hashed PII (Meta requires SHA-256 lowercase)
          em:  hash(userData.email)     ? [hash(userData.email)]     : undefined,
          ph:  hash(normalizePhone(userData.phone)) ? [hash(normalizePhone(userData.phone))] : undefined,
          fn:  hash(userData.firstName),
          ln:  hash(userData.lastName),
          // Browser signals (not hashed)
          client_ip_address: userData.clientIp,
          client_user_agent: userData.clientUserAgent,
          fbp: userData.fbp,
          fbc: userData.fbc,
        },
        custom_data: event.customData,
      },
    ],
    access_token: accessToken,
    // test_event_code: 'TEST12345',  // Uncomment while testing in Events Manager
  };

  try {
    const res = await fetch(CAPI_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[Meta CAPI] Error response:', res.status, body);
    }
  } catch (err) {
    // Non-blocking — CAPI failure should never break the main flow
    console.error('[Meta CAPI] Network error:', err);
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Fire when a loan inquiry is saved (subscription confirmed). */
export function capiLead(opts: {
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  loanType?: string;
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventId?: string;
}): void {
  sendCapiEvent({
    eventName:      'Lead',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: {
      email:           opts.email,
      phone:           opts.phone,
      firstName:       opts.firstName,
      lastName:        opts.lastName,
      clientIp:        opts.clientIp,
      clientUserAgent: opts.clientUserAgent,
      fbp:             opts.fbp,
      fbc:             opts.fbc,
    },
    customData: opts.loanType ? { content_category: opts.loanType, currency: 'INR', value: 100 } : undefined,
  }).catch(() => {});
}

/** Fire when a Razorpay subscription is authorized (₹100/month). */
export function capiSubscribe(opts: {
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
  eventId?: string;
}): void {
  sendCapiEvent({
    eventName:      'Subscribe',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: {
      email:           opts.email,
      phone:           opts.phone,
      firstName:       opts.firstName,
      lastName:        opts.lastName,
      clientIp:        opts.clientIp,
      clientUserAgent: opts.clientUserAgent,
      fbp:             opts.fbp,
      fbc:             opts.fbc,
    },
    customData: { currency: 'INR', value: 100, predicted_ltv: 1200 },
  }).catch(() => {});
}

/** Fire when a user completes email OTP verification (registration complete). */
export function capiCompleteRegistration(opts: {
  email: string;
  firstName?: string;
  lastName?: string;
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;
  fbc?: string;
}): void {
  sendCapiEvent({
    eventName:      'CompleteRegistration',
    eventSourceUrl: 'https://biddaro.com/register',
    userData: {
      email:           opts.email,
      firstName:       opts.firstName,
      lastName:        opts.lastName,
      clientIp:        opts.clientIp,
      clientUserAgent: opts.clientUserAgent,
      fbp:             opts.fbp,
      fbc:             opts.fbc,
    },
  }).catch(() => {});
}
