import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
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
