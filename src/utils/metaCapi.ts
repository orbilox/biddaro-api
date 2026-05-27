/**
 * Meta Conversions API (CAPI) — server-side event forwarding.
 * Pixel ID : 914655691586718
 * Env var  : META_ACCESS_TOKEN  (Events Manager → Pixel → Settings → Conversions API)
 */

import crypto from 'crypto';

const PIXEL_ID      = '914655691586718';
const CAPI_ENDPOINT = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hash(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(phone: string | undefined | null): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
}

function unixNow(): number { return Math.floor(Date.now() / 1000); }

/** Unique event ID for browser ↔ server deduplication */
function genEventId(): string {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapiUserData {
  email?:             string;
  phone?:             string;
  firstName?:         string;
  lastName?:          string;
  city?:              string;   // hashed by us before sending
  state?:             string;   // 2-letter, hashed
  zip?:               string;   // hashed
  country?:           string;   // 2-letter ISO e.g. 'in', hashed
  externalId?:        string;   // user.id — hashed
  subscriptionId?:    string;   // Razorpay subscription ID — NOT hashed
  clientIp?:          string;   // NOT hashed
  clientUserAgent?:   string;   // NOT hashed
  fbp?:               string;   // _fbp cookie — NOT hashed
  fbc?:               string;   // _fbc cookie — NOT hashed
}

export interface CapiEvent {
  eventName:          string;
  eventId?:           string;   // auto-generated if omitted
  eventSourceUrl?:    string;
  userData:           CapiUserData;
  customData?:        Record<string, unknown>;
  /** Set true to attach Data Processing Options (CCPA — required for US traffic) */
  dataProcessing?:    boolean;
}

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendCapiEvent(event: CapiEvent): Promise<void> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Meta CAPI] META_ACCESS_TOKEN not set — skipping:', event.eventName);
    }
    return;
  }

  const u = event.userData;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:       event.eventName,
        event_time:       unixNow(),
        event_id:         event.eventId ?? genEventId(),
        action_source:    'website',
        event_source_url: event.eventSourceUrl ?? 'https://biddaro.com',

        // Data Processing Options — required for CCPA (California)
        ...(event.dataProcessing ? {
          data_processing_options:         ['LDU'],
          data_processing_options_country: 1,
          data_processing_options_state:   1000,
        } : {}),

        user_data: {
          // ── Hashed PII ─────────────────────────────────────────────────────
          em:          hash(u.email)                   ? [hash(u.email)]                   : undefined,
          ph:          hash(normalizePhone(u.phone))   ? [hash(normalizePhone(u.phone))]   : undefined,
          fn:          hash(u.firstName),
          ln:          hash(u.lastName),
          ct:          hash(u.city),
          st:          hash(u.state),
          zp:          hash(u.zip),
          country:     hash(u.country ?? 'in'),
          external_id: hash(u.externalId),
          // ── Not hashed ─────────────────────────────────────────────────────
          subscription_id:   u.subscriptionId,
          client_ip_address: u.clientIp,
          client_user_agent: u.clientUserAgent,
          fbp:               u.fbp,
          fbc:               u.fbc,
        },

        custom_data: event.customData,
      },
    ],
    access_token: accessToken,
  };

  try {
    const res = await fetch(CAPI_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[Meta CAPI] Error:', res.status, body);
    }
  } catch (err) {
    console.error('[Meta CAPI] Network error:', err);
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

type BaseOpts = {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  city?: string; state?: string; country?: string; externalId?: string;
  clientIp?: string; clientUserAgent?: string; fbp?: string; fbc?: string;
  eventId?: string;
};

/** Lead — loan inquiry form submitted */
export function capiLead(opts: BaseOpts & { loanType?: string }): void {
  sendCapiEvent({
    eventName: 'Lead', eventId: opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: opts.loanType
      ? { content_category: opts.loanType, currency: 'INR', value: 100 }
      : undefined,
  }).catch(() => {});
}

/** Subscribe — ₹100/month Razorpay subscription authorized */
export function capiSubscribe(opts: BaseOpts & { subscriptionId?: string }): void {
  sendCapiEvent({
    eventName: 'Subscribe', eventId: opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in', subscriptionId: opts.subscriptionId },
    customData: { currency: 'INR', value: 100, predicted_ltv: 1200 },
  }).catch(() => {});
}

/** CompleteRegistration — user verified OTP / account activated */
export function capiCompleteRegistration(opts: BaseOpts & {
  subscriptionId?: string;
}): void {
  sendCapiEvent({
    eventName: 'CompleteRegistration', eventId: opts.eventId,
    eventSourceUrl: 'https://biddaro.com/register',
    dataProcessing: true,   // attach Data Processing Options as Meta requires
    userData: {
      ...opts, country: opts.country ?? 'in', subscriptionId: opts.subscriptionId,
    },
  }).catch(() => {});
}

/** AddPaymentInfo — Razorpay modal opened (order or subscription created) */
export function capiAddPaymentInfo(opts: BaseOpts & {
  value?: number; currency?: string; contentCategory?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName: 'AddPaymentInfo', eventId: opts.eventId,
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: {
      currency: opts.currency ?? 'INR',
      value: opts.value ?? 100,
      content_category: opts.contentCategory,
    },
  }).catch(() => {});
}

/** Purchase — payment confirmed (loan fee, subscription, wallet deposit) */
export function capiPurchase(opts: BaseOpts & {
  value: number; currency?: string; contentName?: string; orderId?: string;
  subscriptionId?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName: 'Purchase', eventId: opts.eventId,
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com',
    userData: {
      ...opts, country: opts.country ?? 'in', subscriptionId: opts.subscriptionId,
    },
    customData: {
      currency:     opts.currency ?? 'INR',
      value:        opts.value,
      content_name: opts.contentName,
      order_id:     opts.orderId,
    },
  }).catch(() => {});
}

/** SubmitApplication — form / bid / loan application submitted */
export function capiSubmitApplication(opts: BaseOpts & {
  contentCategory?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName: 'SubmitApplication',
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: opts.contentCategory ? { content_category: opts.contentCategory } : undefined,
  }).catch(() => {});
}

/** Contact — contact form submitted */
export function capiContact(opts: BaseOpts): void {
  sendCapiEvent({
    eventName: 'Contact',
    eventSourceUrl: 'https://biddaro.com/contact',
    userData: { ...opts, country: opts.country ?? 'in' },
  }).catch(() => {});
}
