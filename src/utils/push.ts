/**
 * Web Push Notifications Utility
 * VAPID keys are stored in environment variables.
 * Subscriptions are persisted in the User.pushSubs column (JSON array)
 * so they survive server restarts / Railway redeploys.
 */

import webpush from 'web-push';
import { prisma } from '../config/database';

// ─── VAPID setup ─────────────────────────────────────────────────────────────

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BE8Xq2KFLYhyu6oNwni3PIe2pQgYqOFP1ffz3W3UZXqPv1SHdPS197rtax1KCPej9XCGMXDeYXFZR9RvUeP4l74';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '-auZ_Hbw8keLPx99q5q8wCTyP5G2rU6J-svpgmDGcpw';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:support@biddaro.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

export const vapidPublicKey = VAPID_PUBLIC;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSubs(raw: string | null | undefined): webpush.PushSubscription[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as webpush.PushSubscription[]; } catch { return []; }
}

// ─── Save subscription (DB-backed, multi-device) ─────────────────────────────

export async function saveSubscription(userId: string, sub: webpush.PushSubscription) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushSubs: true } });
  const existing = parseSubs(user?.pushSubs);
  // Dedupe by endpoint
  const deduped = existing.filter(s => s.endpoint !== sub.endpoint);
  deduped.push(sub);
  await prisma.user.update({
    where: { id: userId },
    data:  { pushSubs: JSON.stringify(deduped) },
  });
}

// ─── Remove subscription ──────────────────────────────────────────────────────

export async function removeSubscription(userId: string, endpoint: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushSubs: true } });
  const filtered = parseSubs(user?.pushSubs).filter(s => s.endpoint !== endpoint);
  await prisma.user.update({
    where: { id: userId },
    data:  { pushSubs: JSON.stringify(filtered) },
  });
}

// ─── Send push to a user ──────────────────────────────────────────────────────

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; icon?: string; url?: string },
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pushSubs: true } });
  const subs = parseSubs(user?.pushSubs);
  if (subs.length === 0) return;

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
          expired.push(sub.endpoint);
        }
      }
    }),
  );

  // Clean up expired endpoints in DB
  if (expired.length > 0) {
    const fresh = subs.filter(s => !expired.includes(s.endpoint));
    await prisma.user.update({
      where: { id: userId },
      data:  { pushSubs: JSON.stringify(fresh) },
    });
  }
}
