import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { generateSocialPost } from '../utils/socialGen';
import type { AuthenticatedRequest } from '../types';

// ─── Cron: generate one post per run (x-cron-secret protected) ────────────────
export async function generateSocialPostCron(req: AuthenticatedRequest, res: Response) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return sendError(res, 'Unauthorized', 401);
  }

  try {
    const gen = await generateSocialPost();
    const post = await prisma.socialPost.create({
      data: {
        topic:       gen.topic,
        platform:    gen.platform,
        caption:     gen.caption,
        hashtags:    gen.hashtags,
        imagePrompt: gen.imagePrompt,
        imageUrl:    gen.imageUrl,
        source:      'auto',
      },
    });
    return sendSuccess(res, { post }, 'Social post generated');
  } catch (err) {
    return sendError(res, `Generation failed: ${(err as Error).message}`, 500);
  }
}

// ─── Admin: trigger generation now (optional custom topic) ────────────────────
export async function adminGenerateSocialPost(req: AuthenticatedRequest, res: Response) {
  const topic = typeof req.body?.topic === 'string' ? req.body.topic : undefined;
  try {
    const gen = await generateSocialPost(topic);
    const post = await prisma.socialPost.create({
      data: {
        topic:       gen.topic,
        platform:    gen.platform,
        caption:     gen.caption,
        hashtags:    gen.hashtags,
        imagePrompt: gen.imagePrompt,
        imageUrl:    gen.imageUrl,
        source:      'manual',
      },
    });
    return sendSuccess(res, { post }, 'Social post generated');
  } catch (err) {
    return sendError(res, `Generation failed: ${(err as Error).message}`, 500);
  }
}

// ─── Admin: list generated posts ──────────────────────────────────────────────
export async function adminListSocialPosts(req: AuthenticatedRequest, res: Response) {
  const page   = Math.max(1, parseInt(String(req.query.page  || '1')));
  const limit  = Math.min(60, parseInt(String(req.query.limit || '30')));
  const skip   = (page - 1) * limit;
  const status = req.query.status as string | undefined; // draft | used | archived

  const where: Record<string, unknown> = {};
  if (status && ['draft', 'used', 'archived'].includes(status)) where.status = status;

  const [posts, total] = await prisma.$transaction([
    prisma.socialPost.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.socialPost.count({ where }),
  ]);

  return sendSuccess(res, { posts, total, page, limit });
}

// ─── Admin: update status (mark used / archived / draft) ──────────────────────
export async function adminUpdateSocialPost(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  if (!status || !['draft', 'used', 'archived'].includes(status)) {
    return sendError(res, 'status must be draft, used, or archived', 400);
  }
  const post = await prisma.socialPost.update({ where: { id }, data: { status } });
  return sendSuccess(res, { post }, 'Updated');
}

// ─── Admin: delete a post ─────────────────────────────────────────────────────
export async function adminDeleteSocialPost(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  await prisma.socialPost.delete({ where: { id } });
  return sendSuccess(res, null, 'Deleted');
}
