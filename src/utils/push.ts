/**
 * Push Notifications Utility
 * Supports both VAPID (web) and FCM (web + Android/iOS).
 * Subscriptions/tokens are persisted in User.pushSubs and User.fcmTokens.
 */

import webpush from 'web-push';
import { prisma } from '../config/database';
import { getMessaging } from './firebase';

// ─── VAPID setup ─────────────────────────────────────────────────────────────

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BE8Xq2KFLYhyu6oNwni3PIe2pQgYqOFP1ffz3W3UZXqPv1SHdPS197rtax1KCPej9XCGMXDeYXFZR9RvUeP4l74';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '-auZ_Hbw8keLPx99q5q8wCTyP5G2rU6J-svpgmDGcpw';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:support@biddaro.com';

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

export const vapidPublicKey = VAPID_PUBLIC;

// ─── Notification preference check ───────────────────────────────────────────
// Returns true if user has push enabled for this category (or has no prefs saved).
// Categories: bids | contracts | messages | wallet | disputes

export async function userWantsPush(userId: string, category: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { notifPrefs: true } });
    if (!user?.notifPrefs) return true; // default all-on
    const prefs = JSON.parse(user.notifPrefs) as Record<string, boolean>;
    return prefs[category] !== false;
  } catch {
    return true; // fail open
  }
}

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

// ─── FCM token helpers ────────────────────────────────────────────────────────

interface FcmToken { token: string; platform: 'web' | 'android' | 'ios' }

function parseFcmTokens(raw: string | null | undefined): FcmToken[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as FcmToken[]; } catch { return []; }
}

export async function saveFcmToken(userId: string, token: string, platform: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmTokens: true } });
  const existing = parseFcmTokens(user?.fcmTokens);
  const deduped = existing.filter(t => t.token !== token);
  deduped.push({ token, platform: platform as FcmToken['platform'] });
  await prisma.user.update({
    where: { id: userId },
    data:  { fcmTokens: JSON.stringify(deduped) },
  });
}

export async function removeFcmToken(userId: string, token: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmTokens: true } });
  const filtered = parseFcmTokens(user?.fcmTokens).filter(t => t.token !== token);
  await prisma.user.update({
    where: { id: userId },
    data:  { fcmTokens: JSON.stringify(filtered) },
  });
}

// ─── Send push to a user ──────────────────────────────────────────────────────

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; icon?: string; url?: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pushSubs: true, fcmTokens: true },
  });

  // ── VAPID (existing web push) ─────────────────────────────────────────────
  const subs = parseSubs(user?.pushSubs);
  if (subs.length > 0) {
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

    if (expired.length > 0) {
      const fresh = subs.filter(s => !expired.includes(s.endpoint));
      await prisma.user.update({
        where: { id: userId },
        data:  { pushSubs: JSON.stringify(fresh) },
      });
    }
  }

  // ── FCM (web + mobile) ────────────────────────────────────────────────────
  const fcmTokens = parseFcmTokens(user?.fcmTokens);
  if (fcmTokens.length === 0) return;

  // Skip FCM if Firebase env vars not configured
  if (!process.env.FIREBASE_PROJECT_ID) return;

  try {
    const messaging = await getMessaging();
    const result = await messaging.sendEachForMulticast({
      tokens: fcmTokens.map(t => t.token),
      notification: { title: payload.title, body: payload.body },
      webpush: payload.url
        ? { fcmOptions: { link: payload.url } }
        : undefined,
      data: { url: payload.url || '/' },
    });

    // Remove stale tokens
    const invalidTokens: string[] = [];
    result.responses.forEach((resp: { success: boolean; error?: { code?: string } }, idx: number) => {
      if (!resp.success) {
        const code = resp.error?.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(fcmTokens[idx].token);
        }
      }
    });

    if (invalidTokens.length > 0) {
      const fresh = fcmTokens.filter(t => !invalidTokens.includes(t.token));
      await prisma.user.update({
        where: { id: userId },
        data:  { fcmTokens: JSON.stringify(fresh) },
      });
    }
  } catch {
    // FCM failure is non-critical — VAPID already fired
  }
}
