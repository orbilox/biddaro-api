import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import { sendPushToUser, userWantsPush } from '../utils/push';
import { sendNewMessageEmail } from '../utils/email';
import type { AuthenticatedRequest } from '../types';

// ─── Get conversations ────────────────────────────────────────────────────────

export async function getConversations(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  // Get all unique conversations involving this user
  const messages = await prisma.message.findMany({
    where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, profileImage: true, role: true } },
      receiver: { select: { id: true, firstName: true, lastName: true, profileImage: true, role: true } },
      job: { select: { id: true, title: true } },
    },
  });

  // Build conversation map: one entry per unique (jobId, otherUserId) pair
  const convMap = new Map<string, {
    otherUserId: string;
    otherUser: unknown;
    lastMessage: {
      id: string;
      content: string;
      createdAt: Date;
      senderId: string;
      isRead: boolean;
    };
    unreadCount: number;
    jobId: string | null;
    job: { id: string; title: string } | null;
  }>();

  for (const msg of messages) {
    const otherUser = msg.senderId === userId ? msg.receiver : msg.sender;
    const key = `${msg.jobId || 'direct'}_${otherUser.id}`;

    if (!convMap.has(key)) {
      convMap.set(key, {
        otherUserId: otherUser.id,
        otherUser,
        lastMessage: {
          id: msg.id,
          content: msg.content,
          createdAt: msg.createdAt,
          senderId: msg.senderId,
          isRead: msg.isRead,
        },
        unreadCount: 0,
        jobId: msg.jobId,
        job: msg.job ?? null,
      });
    }

    if (!msg.isRead && msg.receiverId === userId) {
      const conv = convMap.get(key)!;
      conv.unreadCount++;
    }
  }

  sendSuccess(res, Array.from(convMap.values()));
}

// ─── Get messages in a conversation ──────────────────────────────────────────

export async function getMessages(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { otherUserId } = req.params;
  const { jobId } = req.query;
  const { page, limit, skip } = getPagination(req);
  const userId = req.user!.userId;

  const where: Record<string, unknown> = {
    OR: [
      { senderId: userId, receiverId: otherUserId },
      { senderId: otherUserId, receiverId: userId },
    ],
  };
  if (jobId) where.jobId = jobId;

  const [messages, total] = await prisma.$transaction([
    prisma.message.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      },
    }),
    prisma.message.count({ where }),
  ]);

  // Mark unread messages as read
  await prisma.message.updateMany({
    where: { senderId: otherUserId, receiverId: userId, isRead: false, ...(jobId ? { jobId: jobId as string } : {}) },
    data: { isRead: true, readAt: new Date() },
  });

  sendSuccess(res, buildPaginatedResult(messages, total, { page, limit, skip }));
}

// ─── Send a message ───────────────────────────────────────────────────────────

export async function sendMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { receiverId, content, jobId, contractId } = req.body;
  const senderId = req.user!.userId;

  if (senderId === receiverId) { sendError(res, 'Cannot send message to yourself', 400); return; }

  // Verify receiver exists
  const receiver = await prisma.user.findUnique({
    where: { id: receiverId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!receiver) { sendNotFound(res, 'Recipient'); return; }

  const message = await prisma.message.create({
    data: { senderId, receiverId, content, jobId: jobId || null, contractId: contractId || null },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
      receiver: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
    },
  });

  // In-app notification for receiver
  prisma.notification.create({
    data: {
      userId: receiverId,
      type: 'new_message',
      title: 'New Message',
      message: `${message.sender.firstName} ${message.sender.lastName} sent you a message`,
      data: JSON.stringify({ url: '/messages' }),
    },
  }).catch(() => {});

  // Push + email notifications (non-blocking, respect preferences)
  userWantsPush(receiverId, 'messages').then(wants => {
    if (wants) {
      sendPushToUser(receiverId, {
        title: 'New Message',
        body: `${message.sender.firstName} sent you a message`,
        url: '/messages',
      }).catch(() => {});
    }
  }).catch(() => {});

  sendNewMessageEmail({
    recipientEmail: receiver.email,
    recipientName: `${receiver.firstName} ${receiver.lastName}`,
    senderName: `${message.sender.firstName} ${message.sender.lastName}`,
  }).catch(() => {});

  sendCreated(res, message, 'Message sent');
}

// ─── Mark conversation as read ────────────────────────────────────────────────

export async function markRead(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { otherUserId } = req.params;
  const { jobId } = req.query;
  const userId = req.user!.userId;

  await prisma.message.updateMany({
    where: {
      senderId: otherUserId,
      receiverId: userId,
      isRead: false,
      ...(jobId ? { jobId: jobId as string } : {}),
    },
    data: { isRead: true, readAt: new Date() },
  });

  sendSuccess(res, null, 'Messages marked as read');
}

// ─── Delete a message ─────────────────────────────────────────────────────────

export async function deleteMessage(req: AuthenticatedRequest, res: Response): Promise<void> {
  const message = await prisma.message.findUnique({ where: { id: req.params.id } });
  if (!message) { sendNotFound(res, 'Message'); return; }
  if (message.senderId !== req.user!.userId) { sendForbidden(res); return; }

  await prisma.message.delete({ where: { id: message.id } });
  sendSuccess(res, null, 'Message deleted');
}

// ─── Get unread count ─────────────────────────────────────────────────────────

export async function getUnreadCount(req: AuthenticatedRequest, res: Response): Promise<void> {
  const count = await prisma.message.count({
    where: { receiverId: req.user!.userId, isRead: false },
  });
  sendSuccess(res, { unreadCount: count });
}
