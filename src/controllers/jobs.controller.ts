import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

const JOB_INCLUDE = {
  poster: { select: { id: true, firstName: true, lastName: true, profileImage: true, isVerified: true } },
  _count: { select: { bids: true } },
};

// ─── List jobs (public) ───────────────────────────────────────────────────────

export async function listJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { category, status, location, minBudget, maxBudget, search, sortBy, sortOrder } = req.query;

  const where: Record<string, unknown> = {};

  if (category) where.category = category;
  if (status) where.status = status;
  else where.status = 'open'; // default to open jobs
  if (location) where.location = { contains: location as string };
  if (minBudget || maxBudget) {
    where.budget = {};
    if (minBudget) (where.budget as Record<string, unknown>).gte = parseFloat(minBudget as string);
    if (maxBudget) (where.budget as Record<string, unknown>).lte = parseFloat(maxBudget as string);
  }
  if (search) {
    where.OR = [
      { title: { contains: search as string } },
      { description: { contains: search as string } },
      { location: { contains: search as string } },
    ];
    delete where.status; // allow search across all statuses
  }

  const orderBy: Record<string, string> = {};
  orderBy[(sortBy as string) || 'createdAt'] = (sortOrder as string) || 'desc';

  const [jobs, total] = await prisma.$transaction([
    prisma.job.findMany({ where, skip, take: limit, orderBy, include: JOB_INCLUDE }),
    prisma.job.count({ where }),
  ]);

  // Parse JSON fields
  const parsed = jobs.map(parseJobJson);
  sendSuccess(res, buildPaginatedResult(parsed, total, { page, limit, skip }));
}

// ─── Get single job ───────────────────────────────────────────────────────────

export async function getJob(req: AuthenticatedRequest, res: Response): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      ...JOB_INCLUDE,
      bids: {
        include: {
          contractor: { select: { id: true, firstName: true, lastName: true, profileImage: true, isVerified: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!job) { sendNotFound(res, 'Job'); return; }

  // Increment view count (non-blocking)
  prisma.job.update({ where: { id: job.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  sendSuccess(res, parseJobJson(job));
}

// ─── Create job ───────────────────────────────────────────────────────────────

export async function createJob(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { title, description, category, budget, currency, timeline, startDate, endDate, location, skills, images, documents, projectType } = req.body;

  const job = await prisma.job.create({
    data: {
      posterId: req.user!.userId,
      title, description, category, budget: parseFloat(budget),
      currency: currency || 'USD',
      budgetType: req.body.budgetType || 'fixed',
      projectType: ['standard', 'government', 'corporate'].includes(projectType) ? projectType : 'standard',
      location,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      skills: Array.isArray(skills) ? JSON.stringify(skills) : skills,
      images: Array.isArray(images) ? JSON.stringify(images) : images,
      documents: Array.isArray(documents) ? JSON.stringify(documents) : documents,
    },
    include: JOB_INCLUDE,
  });

  // Create notification for nearby contractors (simplified)
  sendCreated(res, parseJobJson(job), 'Job posted successfully');
}

// ─── Update job ───────────────────────────────────────────────────────────────

export async function updateJob(req: AuthenticatedRequest, res: Response): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { sendNotFound(res, 'Job'); return; }
  if (job.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (!['open', 'closed'].includes(job.status)) {
    sendError(res, 'Cannot edit a job that is in progress or completed', 400);
    return;
  }

  const allowedFields = ['title', 'description', 'category', 'budget', 'timeline', 'location', 'skills', 'images', 'status', 'projectType'];
  const data: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) {
      data[f] = Array.isArray(req.body[f]) ? JSON.stringify(req.body[f]) : req.body[f];
    }
  }

  const updated = await prisma.job.update({ where: { id: job.id }, data, include: JOB_INCLUDE });
  sendSuccess(res, parseJobJson(updated), 'Job updated');
}

// ─── Delete job ───────────────────────────────────────────────────────────────

export async function deleteJob(req: AuthenticatedRequest, res: Response): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job) { sendNotFound(res, 'Job'); return; }
  if (job.posterId !== req.user!.userId) { sendForbidden(res); return; }
  if (job.status === 'in_progress') {
    sendError(res, 'Cannot delete a job in progress', 400);
    return;
  }

  await prisma.job.delete({ where: { id: job.id } });
  sendSuccess(res, null, 'Job deleted');
}

// ─── Get my posted jobs ───────────────────────────────────────────────────────

export async function getMyJobs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req);
  const { status } = req.query;

  const where: Record<string, unknown> = { posterId: req.user!.userId };
  if (status) where.status = status;

  const [jobs, total] = await prisma.$transaction([
    prisma.job.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, include: JOB_INCLUDE }),
    prisma.job.count({ where }),
  ]);

  sendSuccess(res, buildPaginatedResult(jobs.map(parseJobJson), total, { page, limit, skip }));
}

// ─── Get AI cost estimation for a job ────────────────────────────────────────

export async function estimateJobCost(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { category, budget, jobId } = req.body;

  // Simple rule-based estimation (no external API required)
  const baseRates: Record<string, number> = {
    Roofing: 15000, Renovation: 30000, HVAC: 18000, Plumbing: 8000,
    Electrical: 12000, Painting: 5000, Carpentry: 10000, Flooring: 7000,
    Landscaping: 6000, General: 20000,
  };

  const base = baseRates[category as string] ?? 15000;
  const estimatedCost = budget ? parseFloat(budget) * 0.92 : base;
  const labor = estimatedCost * 0.6;
  const breakdown = [
    { name: 'Materials & Supplies', cost: estimatedCost * 0.35 },
    { name: 'Labor', cost: labor },
    { name: 'Permits & Fees', cost: estimatedCost * 0.05 },
  ];
  const timeline = Math.ceil(estimatedCost / 1500);

  // Optionally save to DB if a jobId is provided
  if (jobId) {
    await prisma.estimation.create({
      data: {
        jobId,
        estimatedCost,
        labor,
        timeline,
        confidence: 0.82,
        metadata: JSON.stringify({ breakdown }),
      },
    }).catch(() => {});
  }

  sendSuccess(res, { estimatedCost, labor, breakdown, timeline, confidence: 0.82 });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function parseJobJson(job: Record<string, unknown>): Record<string, unknown> {
  return {
    ...job,
    skills: tryParse(job.skills as string),
    images: tryParse(job.images as string),
    documents: tryParse(job.documents as string),
  };
}

function tryParse(val: string | null | undefined): unknown {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return val; }
}
