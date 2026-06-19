import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

function parseFcmTokens(raw: string | null | undefined): { platform: string }[] {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

export async function adminPushStats(req: AuthenticatedRequest, res: Response) {
  const now = new Date();
  const d7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Registration counts ──────────────────────────────────────────────────
  const usersWithFcm   = await prisma.user.findMany({
    where:  { fcmTokens: { not: null } },
    select: { fcmTokens: true },
  });
  const usersWithVapid = await prisma.user.count({
    where: { pushSubs: { not: null } },
  });

  // Platform breakdown from JSON
  let web = 0, android = 0, ios = 0;
  for (const u of usersWithFcm) {
    for (const t of parseFcmTokens(u.fcmTokens)) {
      if (t.platform === 'android') android++;
      else if (t.platform === 'ios') ios++;
      else web++;
    }
  }

  // ── Send history aggregates ──────────────────────────────────────────────
  const [agg7d, agg30d, aggAll] = await Promise.all([
    prisma.pushLog.aggregate({
      where: { sentAt: { gte: d7 } },
      _sum:  { fcmSent: true, vapidSent: true, fcmFailed: true, vapidFailed: true },
      _count: { id: true },
    }),
    prisma.pushLog.aggregate({
      where: { sentAt: { gte: d30 } },
      _sum:  { fcmSent: true, vapidSent: true, fcmFailed: true, vapidFailed: true },
      _count: { id: true },
    }),
    prisma.pushLog.aggregate({
      _sum:  { fcmSent: true, vapidSent: true, fcmFailed: true, vapidFailed: true },
      _count: { id: true },
    }),
  ]);

  // ── Recent logs ──────────────────────────────────────────────────────────
  const recentLogs = await prisma.pushLog.findMany({
    orderBy: { sentAt: 'desc' },
    take:    50,
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return sendSuccess(res, {
    registered: {
      fcmTotal:  usersWithFcm.length,
      vapid:     usersWithVapid,
      platforms: { web, android, ios },
    },
    sends: {
      last7d:  { events: agg7d._count.id,  fcm: agg7d._sum.fcmSent  ?? 0, vapid: agg7d._sum.vapidSent  ?? 0, failed: (agg7d._sum.fcmFailed  ?? 0) + (agg7d._sum.vapidFailed  ?? 0) },
      last30d: { events: agg30d._count.id, fcm: agg30d._sum.fcmSent ?? 0, vapid: agg30d._sum.vapidSent ?? 0, failed: (agg30d._sum.fcmFailed ?? 0) + (agg30d._sum.vapidFailed ?? 0) },
      allTime: { events: aggAll._count.id, fcm: aggAll._sum.fcmSent ?? 0, vapid: aggAll._sum.vapidSent ?? 0, failed: (aggAll._sum.fcmFailed ?? 0) + (aggAll._sum.vapidFailed ?? 0) },
    },
    recentLogs,
  });
}
