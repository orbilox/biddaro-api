import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// Users counted as "inspectors": registered via the Inspect app OR have inspect activity.
const INSPECTOR_WHERE = {
  OR: [
    { signupSource: 'inspect_app' },
    { inspectProjects: { some: {} } },
    { inspectReports: { some: {} } },
  ],
};

// ─── Admin: GET /admin/inspect-stats ──────────────────────────────────────────
export async function adminInspectStats(_req: AuthenticatedRequest, res: Response) {
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    inspectorUsers, appSignups, projects, reports, reports30d,
    templates, schedules, recentReports, recentUsers,
  ] = await Promise.all([
    prisma.user.count({ where: INSPECTOR_WHERE }),
    prisma.user.count({ where: { signupSource: 'inspect_app' } }),
    prisma.inspectProject.count(),
    prisma.inspectReport.count(),
    prisma.inspectReport.count({ where: { createdAt: { gte: d30 } } }),
    prisma.inspectTemplate.count(),
    prisma.inspectSchedule.count(),
    prisma.inspectReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, title: true, status: true, createdAt: true,
        user:    { select: { firstName: true, lastName: true, email: true } },
        project: { select: { name: true, location: true } },
      },
    }),
    prisma.user.findMany({
      where: INSPECTOR_WHERE,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, firstName: true, lastName: true, email: true,
        signupSource: true, createdAt: true, isActive: true,
        _count: { select: { inspectProjects: true, inspectReports: true } },
      },
    }),
  ]);

  return sendSuccess(res, {
    totals: {
      inspectorUsers,
      appSignups,
      projects,
      reports,
      reports30d,
      templates,
      schedules,
    },
    recentReports,
    recentUsers,
  });
}
