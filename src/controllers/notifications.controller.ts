import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { saveSubscription, removeSubscription, vapidPublicKey } from '../utils/push';
import type { AuthenticatedRequest } from '../types';

export async function getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { isRead } = req.query;
  const userId = req.user!.userId;

  const where: Record<string, unknown> = { userId };
  if (isRead !== undefined) where.isRead = isRead === 'true';

  const [notifications, total] = await prisma.$transaction([
    prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
  ]);

  sendSuccess(res, buildPaginatedResult(notifications, total, { page, limit, skip }));
}

export async function markNotificationRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId: req.user!.userId, id: req.params.id },
    data: { isRead: true },
  });
  sendSuccess(res, null, 'Notification marked as read');
}

export async function markAllRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId: req.user!.userId, isRead: false },
    data: { isRead: true },
  });
  sendSuccess(res, null, 'All notifications marked as read');
}

export async function getUnreadCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const count = await prisma.notification.count({
    where: { userId: req.user!.userId, isRead: false },
  });
  sendSuccess(res, { unreadCount: count });
}

// ─── Push subscription endpoints ─────────────────────────────────────────────

/** Returns the VAPID public key so the browser can subscribe */
export function getVapidPublicKey(_req: AuthenticatedRequest, res: Response): void {
  sendSuccess(res, { publicKey: vapidPublicKey });
}

/** Save a browser push subscription for this user */
export async function subscribePush(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ success: false, message: 'Invalid subscription object' });
    return;
  }
  saveSubscription(userId, { endpoint, keys });
  sendSuccess(res, null, 'Push subscription saved');
}

/** Remove a browser push subscription (user unsubscribed / changed device) */
export async function unsubscribePush(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { endpoint } = req.body;
  if (endpoint) removeSubscription(userId, endpoint);
  sendSuccess(res, null, 'Push subscription removed');
}
