import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { generateSocialPost, topicForIndex } from '../utils/socialGen';
import type { AuthenticatedRequest } from '../types';

// ─── Cron: fill today's planned calendar slot, else generate a fresh post ─────
export async function generateSocialPostCron(req: AuthenticatedRequest, res: Response) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return sendError(res, 'Unauthorized', 401);
  }

  try {
    // Look for a planned-but-empty slot scheduled for today.
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);

    const slot = await prisma.socialPost.findFirst({
      where: { status: 'planned', scheduledFor: { gte: start, lte: end } },
      orderBy: { scheduledFor: 'asc' },
    });

    const gen = await generateSocialPost(slot?.topic);

    if (slot) {
      const post = await prisma.socialPost.update({
        where: { id: slot.id },
        data: {
          caption:     gen.caption,
          hashtags:    gen.hashtags,
          imagePrompt: gen.imagePrompt,
          imageUrl:    gen.imageUrl,
          imageError:  gen.imageError ?? null,
          status:      'draft',
        },
      });
      return sendSuccess(res, { post, filledSlot: true }, 'Planned slot generated');
    }

    const post = await prisma.socialPost.create({
      data: {
        topic:       gen.topic,
        platform:    gen.platform,
        caption:     gen.caption,
        hashtags:    gen.hashtags,
        imagePrompt: gen.imagePrompt,
        imageUrl:    gen.imageUrl,
        imageError:  gen.imageError ?? null,
        source:      'auto',
        scheduledFor: new Date(),
      },
    });
    return sendSuccess(res, { post, filledSlot: false }, 'Social post generated');
  } catch (err) {
    return sendError(res, `Generation failed: ${(err as Error).message}`, 500);
  }
}

// ─── Admin: plan a month of empty slots (no API cost) ─────────────────────────
export async function adminPlanMonth(req: AuthenticatedRequest, res: Response) {
  const year    = parseInt(String(req.body?.year));
  const month   = parseInt(String(req.body?.month)); // 1-12
  const cadence = String(req.body?.cadence || 'daily'); // daily | weekdays | mwf | custom
  const customDays: number[] = Array.isArray(req.body?.customDays) ? req.body.customDays : []; // 0=Sun..6=Sat

  if (!year || !month || month < 1 || month > 12) {
    return sendError(res, 'Valid year and month (1-12) are required', 400);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: Date[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d, 9, 0, 0); // 9am local
    const dow = date.getDay(); // 0=Sun..6=Sat
    let include = false;
    if (cadence === 'daily')        include = true;
    else if (cadence === 'weekdays') include = dow >= 1 && dow <= 5;
    else if (cadence === 'mwf')      include = dow === 1 || dow === 3 || dow === 5;
    else if (cadence === 'custom')   include = customDays.includes(dow);
    if (include) dates.push(date);
  }

  // Skip dates that already have a slot, so re-planning doesn't duplicate.
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0);
  const monthEnd   = new Date(year, month - 1, daysInMonth, 23, 59, 59);
  const existing = await prisma.socialPost.findMany({
    where: { scheduledFor: { gte: monthStart, lte: monthEnd } },
    select: { scheduledFor: true },
  });
  const taken = new Set(existing.map(e => e.scheduledFor ? new Date(e.scheduledFor).toDateString() : ''));

  const toCreate = dates.filter(d => !taken.has(d.toDateString()));
  let created = 0;
  for (let i = 0; i < toCreate.length; i++) {
    await prisma.socialPost.create({
      data: {
        topic:        topicForIndex(i),
        status:       'planned',
        source:       'manual',
        scheduledFor: toCreate[i],
      },
    });
    created++;
  }

  return sendSuccess(res, { created, skipped: dates.length - toCreate.length }, `Planned ${created} day(s)`);
}

// ─── Admin: generate content for one existing slot ────────────────────────────
export async function adminGenerateSlot(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const slot = await prisma.socialPost.findUnique({ where: { id } });
  if (!slot) return sendError(res, 'Slot not found', 404);

  try {
    const gen = await generateSocialPost(slot.topic);
    const post = await prisma.socialPost.update({
      where: { id },
      data: {
        caption:     gen.caption,
        hashtags:    gen.hashtags,
        imagePrompt: gen.imagePrompt,
        imageUrl:    gen.imageUrl,
        imageError:  gen.imageError ?? null,
        status:      slot.status === 'planned' ? 'draft' : slot.status,
      },
    });
    return sendSuccess(res, { post, imageError: gen.imageError }, 'Generated');
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
        imageError:  gen.imageError ?? null,
        source:      'manual',
      },
    });
    return sendSuccess(res, { post, imageError: gen.imageError }, 'Social post generated');
  } catch (err) {
    return sendError(res, `Generation failed: ${(err as Error).message}`, 500);
  }
}

// ─── Admin: list posts (list view + calendar view via from/to) ────────────────
export async function adminListSocialPosts(req: AuthenticatedRequest, res: Response) {
  const status = req.query.status as string | undefined; // planned | draft | used | archived
  const from   = req.query.from as string | undefined;    // ISO date — calendar range start
  const to     = req.query.to   as string | undefined;    // ISO date — calendar range end

  const where: Record<string, unknown> = {};
  if (status && ['planned', 'draft', 'used', 'archived'].includes(status)) where.status = status;

  // Calendar mode: return everything scheduled within the range, ordered by date.
  if (from && to) {
    where.scheduledFor = { gte: new Date(from), lte: new Date(to) };
    const posts = await prisma.socialPost.findMany({
      where,
      orderBy: { scheduledFor: 'asc' },
    });
    return sendSuccess(res, { posts, total: posts.length });
  }

  // List mode: paginated, newest first. Planned (ungenerated) slots are
  // calendar-only placeholders — exclude them from the flat post library
  // unless explicitly requested.
  if (where.status === undefined) where.status = { not: 'planned' };

  const page  = Math.max(1, parseInt(String(req.query.page  || '1')));
  const limit = Math.min(60, parseInt(String(req.query.limit || '30')));
  const skip  = (page - 1) * limit;

  const [posts, total] = await prisma.$transaction([
    prisma.socialPost.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    prisma.socialPost.count({ where }),
  ]);

  return sendSuccess(res, { posts, total, page, limit });
}

// ─── Admin: create a single slot on a date (custom note/topic) ────────────────
export async function adminCreateSocialPost(req: AuthenticatedRequest, res: Response) {
  const { scheduledFor, topic, caption } = req.body as {
    scheduledFor?: string; topic?: string; caption?: string;
  };
  if (!topic || !String(topic).trim()) {
    return sendError(res, 'A note/topic is required', 400);
  }
  const post = await prisma.socialPost.create({
    data: {
      topic:        String(topic).trim(),
      caption:      caption ? String(caption) : '',
      status:       caption ? 'draft' : 'planned',
      source:       'manual',
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    },
  });
  return sendSuccess(res, { post }, 'Created');
}

// ─── Admin: update a post (status and/or editable content) ────────────────────
export async function adminUpdateSocialPost(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  const { status, topic, caption, hashtags } = req.body as {
    status?: string; topic?: string; caption?: string; hashtags?: string;
  };

  const data: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!['planned', 'draft', 'used', 'archived'].includes(status)) {
      return sendError(res, 'Invalid status', 400);
    }
    data.status = status;
  }
  if (topic    !== undefined) data.topic    = String(topic);
  if (caption  !== undefined) data.caption  = String(caption);
  if (hashtags !== undefined) data.hashtags = hashtags === '' ? null : String(hashtags);

  if (Object.keys(data).length === 0) {
    return sendError(res, 'Nothing to update', 400);
  }

  const post = await prisma.socialPost.update({ where: { id }, data });
  return sendSuccess(res, { post }, 'Updated');
}

// ─── Admin: delete a post ─────────────────────────────────────────────────────
export async function adminDeleteSocialPost(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params;
  await prisma.socialPost.delete({ where: { id } });
  return sendSuccess(res, null, 'Deleted');
}
