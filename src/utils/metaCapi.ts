/**
 * Meta Conversions API (CAPI) — server-side event forwarding.
 * Pixel ID : 914655691586718
 * Env var  : META_ACCESS_TOKEN  (Events Manager → Pixel → Settings → Conversions API)
 *
 * Graph API v21.0  (current as of 2026)
 */

import crypto from 'crypto';

const PIXEL_ID      = '914655691586718';
const CAPI_ENDPOINT = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hash a string value (normalised to trimmed lowercase first). */
function hash(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Normalise a phone number to E.164 format based on the user's country.
 * Returns digits only (no '+'), which is what Meta expects.
 */
function normalizePhone(
  phone: string | undefined | null,
  country: string | undefined | null
): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  const c = (country ?? 'in').toLowerCase();
  // If already has a leading country code (10+ digits likely already prefixed)
  if (digits.length >= 11) return digits;
  if (c === 'ae') return `971${digits}`;   // UAE  +971
  if (c === 'sg') return `65${digits}`;    // Singapore +65
  if (c === 'us') return `1${digits}`;     // USA  +1
  return `91${digits}`;                    // India +91 (default)
}

function unixNow(): number { return Math.floor(Date.now() / 1000); }

/** Unique event ID for browser ↔ server deduplication */
function genEventId(): string {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Construct the `fbc` click identifier from the `fbclid` URL query parameter
 * when the `_fbc` cookie is absent.
 * Format: fb.{subdomainIndex}.{creationTime}.{fbclid}
 */
function buildFbc(fbclid: string | undefined | null, timestamp?: number): string | undefined {
  if (!fbclid) return undefined;
  const ts = timestamp ?? unixNow();
  return `fb.1.${ts}.${fbclid}`;
}

/**
 * Whether to attach CCPA Data Processing Options (Limited Data Use).
 * LDU must ONLY be sent for US users — applying it globally suppresses
 * audience matching for Indian, UAE, and Singapore users.
 */
function isUSUser(country: string | undefined | null): boolean {
  return (country ?? '').toLowerCase() === 'us';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapiUserData {
  email?:           string;
  phone?:           string;
  firstName?:       string;
  lastName?:        string;
  city?:            string;   // hashed before sending
  state?:           string;   // 2-letter ISO, hashed
  zip?:             string;   // postal code, hashed
  country?:         string;   // 2-letter ISO e.g. 'in' | 'ae' | 'sg' | 'us'
  dateOfBirth?:     string;   // YYYYMMDD format, hashed
  externalId?:      string;   // user.id — hashed
  clientIp?:        string;   // NOT hashed (required for server events)
  clientUserAgent?: string;   // NOT hashed (required for server events)
  fbp?:             string;   // _fbp browser cookie — NOT hashed
  fbc?:             string;   // _fbc cookie or fb.1.{ts}.{fbclid} — NOT hashed
  fbclid?:          string;   // raw fbclid URL param (used to build fbc if cookie absent)
}

export interface CapiEvent {
  eventName:        string;
  eventId?:         string;   // auto-generated if omitted
  eventSourceUrl?:  string;
  actionSource?:    'website' | 'app' | 'email' | 'phone_call' | 'chat' | 'physical_store' | 'system_generated' | 'other';
  userData:         CapiUserData;
  customData?:      Record<string, unknown>;
  /**
   * Only set true for US traffic (CCPA).
   * Default: auto-detected from userData.country.
   */
  dataProcessing?:  boolean;
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
  const country = (u.country ?? 'in').toLowerCase();

  // ── Compute hashes once (never double-hash) ──────────────────────────────
  const hashedEmail    = hash(u.email);
  const hashedPhone    = hash(normalizePhone(u.phone, country));
  const hashedFn       = hash(u.firstName);
  const hashedLn       = hash(u.lastName);
  const hashedCt       = hash(u.city);
  const hashedSt       = hash(u.state);
  const hashedZp       = hash(u.zip);
  const hashedCountry  = hash(country);
  const hashedDob      = hash(u.dateOfBirth);
  const hashedExtId    = hash(u.externalId);

  // ── fbc: prefer cookie, fall back to fbclid URL param ────────────────────
  const fbc = u.fbc || buildFbc(u.fbclid);

  // ── CCPA Data Processing Options — US users only ─────────────────────────
  const applyLDU = event.dataProcessing ?? isUSUser(country);

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name:       event.eventName,
        event_time:       unixNow(),
        event_id:         event.eventId ?? genEventId(),
        action_source:    event.actionSource ?? 'website',
        event_source_url: event.eventSourceUrl ?? 'https://biddaro.com',

        ...(applyLDU ? {
          data_processing_options:         ['LDU'],
          data_processing_options_country: 1,
          data_processing_options_state:   1000,
        } : {}),

        user_data: {
          // ── Hashed PII — always send as arrays (Meta's canonical format) ──
          ...(hashedEmail   && { em:          [hashedEmail] }),
          ...(hashedPhone   && { ph:          [hashedPhone] }),
          ...(hashedFn      && { fn:          hashedFn }),
          ...(hashedLn      && { ln:          hashedLn }),
          ...(hashedCt      && { ct:          hashedCt }),
          ...(hashedSt      && { st:          hashedSt }),
          ...(hashedZp      && { zp:          hashedZp }),
          ...(hashedCountry && { country:     hashedCountry }),
          ...(hashedDob     && { db:          hashedDob }),
          ...(hashedExtId   && { external_id: hashedExtId }),
          // ── Not hashed (required for server events) ────────────────────────
          ...(u.clientIp          && { client_ip_address: u.clientIp }),
          ...(u.clientUserAgent   && { client_user_agent: u.clientUserAgent }),
          ...(u.fbp               && { fbp: u.fbp }),
          ...(fbc                 && { fbc }),
        },

        ...(event.customData && { custom_data: event.customData }),
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
  email?:          string;
  phone?:          string;
  firstName?:      string;
  lastName?:       string;
  city?:           string;
  state?:          string;
  zip?:            string;
  country?:        string;
  dateOfBirth?:    string;
  externalId?:     string;
  clientIp?:       string;
  clientUserAgent?: string;
  fbp?:            string;
  fbc?:            string;
  fbclid?:         string;
  eventId?:        string;
};

/**
 * CompleteRegistration — user verified OTP / account activated.
 *
 * Sends all available PII for maximum Event Match Quality.
 * CCPA LDU applied automatically for US users only.
 */
export function capiCompleteRegistration(
  opts: BaseOpts & { registrationSource?: string }
): void {
  sendCapiEvent({
    eventName:      'CompleteRegistration',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/register',
    actionSource:   'website',
    userData: {
      email:          opts.email,
      phone:          opts.phone,
      firstName:      opts.firstName,
      lastName:       opts.lastName,
      city:           opts.city,
      state:          opts.state,
      zip:            opts.zip,
      country:        opts.country ?? 'in',
      dateOfBirth:    opts.dateOfBirth,
      externalId:     opts.externalId,
      clientIp:       opts.clientIp,
      clientUserAgent: opts.clientUserAgent,
      fbp:            opts.fbp,
      fbc:            opts.fbc,
      fbclid:         opts.fbclid,
    },
    customData: {
      status:              true,
      registration_source: opts.registrationSource ?? 'organic',
      currency:            'INR',
      value:               0,
    },
  }).catch(() => {});
}

/** Lead — loan inquiry form submitted */
export function capiLead(opts: BaseOpts & { loanType?: string }): void {
  sendCapiEvent({
    eventName:      'Lead',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: opts.loanType
      ? { content_category: opts.loanType, currency: 'INR', value: 100 }
      : undefined,
  }).catch(() => {});
}

/** Subscribe — Razorpay subscription authorized */
export function capiSubscribe(opts: BaseOpts & {
  subscriptionId?: string;
  value?: number;
}): void {
  sendCapiEvent({
    eventName:      'Subscribe',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: {
      currency:        'INR',
      value:           opts.value ?? 100,
      predicted_ltv:   1200,
      subscription_id: opts.subscriptionId,   // ← custom_data, not user_data
    },
  }).catch(() => {});
}

/** AddPaymentInfo — Razorpay modal opened (order or subscription created) */
export function capiAddPaymentInfo(opts: BaseOpts & {
  value?: number; currency?: string; contentCategory?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName:      'AddPaymentInfo',
    eventId:        opts.eventId,
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com/loan-apply',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: {
      currency:         opts.currency ?? 'INR',
      value:            opts.value ?? 100,
      content_category: opts.contentCategory,
    },
  }).catch(() => {});
}

/** Purchase — payment confirmed (loan fee, subscription, wallet deposit) */
export function capiPurchase(opts: BaseOpts & {
  value: number; currency?: string; contentName?: string;
  orderId?: string; subscriptionId?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName:      'Purchase',
    eventId:        opts.eventId,
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: {
      currency:        opts.currency ?? 'INR',
      value:           opts.value,
      content_name:    opts.contentName,
      order_id:        opts.orderId,
      subscription_id: opts.subscriptionId,  // ← custom_data, not user_data
    },
  }).catch(() => {});
}

/** SubmitApplication — form / bid / loan application submitted */
export function capiSubmitApplication(opts: BaseOpts & {
  contentCategory?: string; sourceUrl?: string;
}): void {
  sendCapiEvent({
    eventName:      'SubmitApplication',
    eventId:        opts.eventId,
    eventSourceUrl: opts.sourceUrl ?? 'https://biddaro.com',
    userData: { ...opts, country: opts.country ?? 'in' },
    customData: opts.contentCategory
      ? { content_category: opts.contentCategory }
      : undefined,
  }).catch(() => {});
}

/** Contact — contact form submitted */
export function capiContact(opts: BaseOpts): void {
  sendCapiEvent({
    eventName:      'Contact',
    eventId:        opts.eventId,
    eventSourceUrl: 'https://biddaro.com/contact',
    userData: { ...opts, country: opts.country ?? 'in' },
  }).catch(() => {});
}
