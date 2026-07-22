import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// Users counted as "safety users": registered via the Safety app OR have safety activity.
const SAFETY_WHERE = {
  OR: [
    { signupSource: 'safety_app' },
    { safetySites: { some: {} } },
    { safetyAudits: { some: {} } },
  ],
};

// ─── Admin: GET /admin/safety-stats ──────────────────────────────────────────
export async function adminSafetyStats(_req: AuthenticatedRequest, res: Response) {
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    safetyUsers, appSignups, sites, talks, audits, audits30d,
    hazards, openHazards, recentAudits, recentUsers,
  ] = await Promise.all([
    prisma.user.count({ where: SAFETY_WHERE }),
    prisma.user.count({ where: { signupSource: 'safety_app' } }),
    prisma.safetySite.count(),
    prisma.safetyToolboxTalk.count(),
    prisma.safetyAudit.count(),
    prisma.safetyAudit.count({ where: { createdAt: { gte: d30 } } }),
    prisma.safetyHazard.count(),
    prisma.safetyHazard.count({ where: { status: { not: 'closed' } } }),
    prisma.safetyAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, templateName: true, status: true, score: true, createdAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        site: { select: { name: true, location: true } },
      },
    }),
    prisma.user.findMany({
      where: SAFETY_WHERE,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        signupSource: true, createdAt: true, isActive: true,
        _count: { select: { safetySites: true, safetyAudits: true } },
      },
    }),
  ]);

  return sendSuccess(res, {
    totals: {
      safetyUsers,
      appSignups,
      sites,
      talks,
      audits,
      audits30d,
      hazards,
      openHazards,
    },
    recentAudits,
    recentUsers,
  });
}
