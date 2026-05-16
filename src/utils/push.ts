/**
 * Web Push Notifications Utility
 * VAPID keys are stored in environment variables.
 * In-memory subscription store (resets on restart — swap for DB in production).
 */

import webpush from 'web-push';

// ─── VAPID setup ─────────────────────────────────────────────────────────────

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BE8Xq2KFLYhyu6oNwni3PIe2pQgYqOFP1ffz3W3UZXqPv1SHdPS197rtax1KCPej9XCGMXDeYXFZR9RvUeP4l74';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '-auZ_Hbw8keLPx99q5q8wCTyP5G2rU6J-svpgmDGcpw';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:support@biddaro.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

export const vapidPublicKey = VAPID_PUBLIC;

// ─── In-memory subscription store ────────────────────────────────────────────
// Maps userId → array of PushSubscription objects (multi-device)

const subscriptions = new Map<string, webpush.PushSubscription[]>();

export function saveSubscription(userId: string, sub: webpush.PushSubscription) {
  const existing = subscriptions.get(userId) ?? [];
  // Dedupe by endpoint
  const filtered = existing.filter(s => s.endpoint !== sub.endpoint);
  subscriptions.set(userId, [...filtered, sub]);
}

export function removeSubscription(userId: string, endpoint: string) {
  const existing = subscriptions.get(userId) ?? [];
  subscriptions.set(userId, existing.filter(s => s.endpoint !== endpoint));
}

// ─── Send push to a user ──────────────────────────────────────────────────────

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; icon?: string; url?: string },
) {
  const subs = subscriptions.get(userId);
  if (!subs || subs.length === 0) return;

  const json = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    icon:  payload.icon || '/favicon.png',
    url:   payload.url  || '/',
  });

  const expired: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, json);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired
          expired.push(sub.endpoint);
        }
      }
    }),
  );

  // Clean up expired
  if (expired.length > 0) {
    const fresh = (subscriptions.get(userId) ?? []).filter(s => !expired.includes(s.endpoint));
    subscriptions.set(userId, fresh);
  }
}
