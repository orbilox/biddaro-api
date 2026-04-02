import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound, sendForbidden } from '../utils/response';
import type { AuthenticatedRequest } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_SELECT = { id: true, firstName: true, lastName: true, profileImage: true };

async function requireAddon(userId: string, res: Response): Promise<boolean> {
  const rec = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: 'project-manager' } },
  });
  if (!rec?.isActive) {
    sendError(res, 'Project Manager add-on is not installed', 403);
    return false;
  }
  return true;
}

async function ownProject(projectId: string, userId: string): Promise<boolean> {
  const p = await prisma.pMProject.findUnique({ where: { id: projectId }, select: { contractorId: true } });
  return p?.contractorId === userId;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROJECTS
// ═══════════════════════════════════════════════════════════════════════════

export async function listProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  if (!(await requireAddon(userId, res))) return;

  const projects = await prisma.pMProject.findMany({
    where: { contractorId: userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { tasks: true, milestones: true, discussions: true, files: true } },
    },
  });

  // Compute task completion per project
  const enriched = await Promise.all(projects.map(async (p) => {
    const [total, done] = await Promise.all([
      prisma.pMTask.count({ where: { projectId: p.id, parentId: null } }),
      prisma.pMTask.count({ where: { projectId: p.id, parentId: null, status: 'done' } }),
    ]);
    return { ...p, taskStats: { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 } };
  }));

  sendSuccess(res, enriched);
}

export async function createProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  if (!(await requireAddon(userId, res))) return;

  const { title, description, color, emoji, contractId } = req.body;
  if (!title?.trim()) { sendError(res, 'Title is required'); return; }

  const project = await prisma.pMProject.create({
    data: {
      contractorId: userId,
      title: title.trim(),
      description: description?.trim() || null,
      color: color || '#6366f1',
      emoji: emoji || '📁',
      contractId: contractId || null,
    },
  });

  res.status(201).json({ success: true, message: 'Project created', data: project });
}

export async function updateProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;

  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(id, userId))) { sendForbidden(res); return; }

  const { title, description, color, emoji, status } = req.body;
  const project = await prisma.pMProject.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description.trim() || null }),
      ...(color !== undefined && { color }),
      ...(emoji !== undefined && { emoji }),
      ...(status !== undefined && { status }),
    },
  });
  sendSuccess(res, project);
}

export async function deleteProject(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(id, userId))) { sendForbidden(res); return; }
  await prisma.pMProject.delete({ where: { id } });
  sendSuccess(res, null, 'Project deleted');
}

// ── Contract suggestions ── active contracts with no linked PM project yet ────

export async function contractSuggestions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  if (!(await requireAddon(userId, res))) return;

  // Active contracts for this contractor
  const contracts = await prisma.contract.findMany({
    where: { contractorId: userId, status: { in: ['active', 'disputed'] } },
    include: {
      job: { select: { id: true, title: true, category: true, location: true, description: true } },
      poster: { select: { id: true, firstName: true, lastName: true, profileImage: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // PM projects that already link a contract
  const linked = await prisma.pMProject.findMany({
    where: { contractorId: userId, contractId: { not: null } },
    select: { contractId: true },
  });
  const linkedIds = new Set(linked.map((p) => p.contractId));

  const suggestions = contracts.filter((c) => !linkedIds.has(c.id));
  sendSuccess(res, suggestions);
}

// ── Import contract ── auto-create a PM project from a contract ───────────────

export async function importContract(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { contractId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, contractorId: userId },
    include: { job: { select: { title: true, category: true, description: true } } },
  });
  if (!contract) { sendNotFound(res, 'Contract'); return; }

  // Prevent duplicate import
  const existing = await prisma.pMProject.findFirst({
    where: { contractorId: userId, contractId },
  });
  if (existing) { sendError(res, 'A project for this contract already exists'); return; }

  // Build a concise description from contract data
  const description = [
    `Category: ${contract.job.category}`,
    `Contract value: ${contract.totalAmount} ${contract.currency}`,
    contract.job.description ? contract.job.description.slice(0, 120) + (contract.job.description.length > 120 ? '…' : '') : null,
  ].filter(Boolean).join(' · ');

  const project = await prisma.pMProject.create({
    data: {
      contractorId: userId,
      contractId,
      title: contract.job.title,
      description,
      color: '#3b82f6',
      emoji: '🏗️',
      status: 'active',
    },
  });

  res.status(201).json({ success: true, message: 'Project imported from contract', data: project });
}

export async function getProjectOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(id, userId))) { sendForbidden(res); return; }

  const now = new Date();

  const [project, totalTasks, doneTasks, overdueTasks, totalMilestones, doneMilestones, totalTime, recentActivity] = await Promise.all([
    prisma.pMProject.findUnique({ where: { id } }),
    prisma.pMTask.count({ where: { projectId: id, parentId: null } }),
    prisma.pMTask.count({ where: { projectId: id, parentId: null, status: 'done' } }),
    prisma.pMTask.count({ where: { projectId: id, parentId: null, dueDate: { lt: now }, status: { not: 'done' } } }),
    prisma.pMMilestone.count({ where: { projectId: id } }),
    prisma.pMMilestone.count({ where: { projectId: id, status: 'completed' } }),
    prisma.pMTimeEntry.aggregate({ where: { projectId: id }, _sum: { minutes: true } }),
    prisma.pMTask.findMany({ where: { projectId: id }, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, title: true, status: true, updatedAt: true } }),
  ]);

  const inProgressTasks = await prisma.pMTask.count({ where: { projectId: id, parentId: null, status: 'in_progress' } });

  sendSuccess(res, {
    project,
    stats: {
      totalTasks,
      doneTasks,
      inProgressTasks,
      overdueTasks,
      completionPercent: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
      totalMilestones,
      doneMilestones,
      totalMinutes: totalTime._sum.minutes ?? 0,
      totalHours: Math.round(((totalTime._sum.minutes ?? 0) / 60) * 10) / 10,
    },
    recentActivity,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════

export async function listTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const tasks = await prisma.pMTask.findMany({
    where: { projectId, parentId: null },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      milestone: { select: { id: true, title: true, color: true } },
      _count: { select: { subTasks: true, timeEntries: true } },
      subTasks: {
        orderBy: { order: 'asc' },
        select: { id: true, title: true, status: true, priority: true },
      },
    },
  });

  sendSuccess(res, tasks);
}

export async function createTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const { title, description, status, priority, dueDate, milestoneId, parentId } = req.body;
  if (!title?.trim()) { sendError(res, 'Title is required'); return; }

  const maxOrder = await prisma.pMTask.aggregate({
    where: { projectId, status: status || 'todo', parentId: parentId || null },
    _max: { order: true },
  });

  const task = await prisma.pMTask.create({
    data: {
      projectId,
      title: title.trim(),
      description: description?.trim() || null,
      status: status || 'todo',
      priority: priority || 'medium',
      dueDate: dueDate ? new Date(dueDate) : null,
      milestoneId: milestoneId || null,
      parentId: parentId || null,
      order: (maxOrder._max.order ?? -1) + 1,
    },
    include: {
      milestone: { select: { id: true, title: true, color: true } },
      _count: { select: { subTasks: true } },
    },
  });

  res.status(201).json({ success: true, message: 'Task created', data: task });
}

export async function updateTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const task = await prisma.pMTask.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task) { sendNotFound(res, 'Task'); return; }
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(task.projectId, userId))) { sendForbidden(res); return; }

  const { title, description, status, priority, dueDate, milestoneId, order } = req.body;
  const updated = await prisma.pMTask.update({
    where: { id: taskId },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(milestoneId !== undefined && { milestoneId: milestoneId || null }),
      ...(order !== undefined && { order }),
    },
    include: { milestone: { select: { id: true, title: true, color: true } }, _count: { select: { subTasks: true } } },
  });

  sendSuccess(res, updated);
}

export async function deleteTask(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { taskId } = req.params;
  const task = await prisma.pMTask.findUnique({ where: { id: taskId }, select: { projectId: true } });
  if (!task) { sendNotFound(res, 'Task'); return; }
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(task.projectId, userId))) { sendForbidden(res); return; }
  await prisma.pMTask.delete({ where: { id: taskId } });
  sendSuccess(res, null, 'Task deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
// MILESTONES
// ═══════════════════════════════════════════════════════════════════════════

export async function listMilestones(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const milestones = await prisma.pMMilestone.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { dueDate: 'asc' }],
    include: {
      _count: { select: { tasks: true } },
      tasks: { select: { id: true, status: true } },
    },
  });

  const enriched = milestones.map((m) => ({
    ...m,
    taskStats: {
      total: m.tasks.length,
      done: m.tasks.filter((t) => t.status === 'done').length,
      percent: m.tasks.length > 0
        ? Math.round((m.tasks.filter((t) => t.status === 'done').length / m.tasks.length) * 100)
        : 0,
    },
  }));

  sendSuccess(res, enriched);
}

export async function createMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const { title, description, dueDate, color } = req.body;
  if (!title?.trim()) { sendError(res, 'Title is required'); return; }

  const maxOrder = await prisma.pMMilestone.aggregate({ where: { projectId }, _max: { order: true } });
  const milestone = await prisma.pMMilestone.create({
    data: {
      projectId,
      title: title.trim(),
      description: description?.trim() || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      color: color || '#6366f1',
      order: (maxOrder._max.order ?? -1) + 1,
    },
  });

  res.status(201).json({ success: true, message: 'Milestone created', data: milestone });
}

export async function updateMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { milestoneId } = req.params;
  const ms = await prisma.pMMilestone.findUnique({ where: { id: milestoneId }, select: { projectId: true } });
  if (!ms) { sendNotFound(res, 'Milestone'); return; }
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(ms.projectId, userId))) { sendForbidden(res); return; }

  const { title, description, dueDate, color, status } = req.body;
  const updated = await prisma.pMMilestone.update({
    where: { id: milestoneId },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(color !== undefined && { color }),
      ...(status !== undefined && { status }),
    },
  });
  sendSuccess(res, updated);
}

export async function deleteMilestone(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { milestoneId } = req.params;
  const ms = await prisma.pMMilestone.findUnique({ where: { id: milestoneId }, select: { projectId: true } });
  if (!ms) { sendNotFound(res, 'Milestone'); return; }
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(ms.projectId, userId))) { sendForbidden(res); return; }
  await prisma.pMMilestone.delete({ where: { id: milestoneId } });
  sendSuccess(res, null, 'Milestone deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCUSSIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function listDiscussions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const discussions = await prisma.pMDiscussion.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: USER_SELECT },
      _count: { select: { replies: true } },
    },
  });
  sendSuccess(res, discussions);
}

export async function createDiscussion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const { title, content } = req.body;
  if (!title?.trim() || !content?.trim()) { sendError(res, 'Title and content are required'); return; }

  const disc = await prisma.pMDiscussion.create({
    data: { projectId, authorId: userId, title: title.trim(), content: content.trim() },
    include: { author: { select: USER_SELECT }, _count: { select: { replies: true } } },
  });
  res.status(201).json({ success: true, message: 'Discussion created', data: disc });
}

export async function getDiscussion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { discussionId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const disc = await prisma.pMDiscussion.findUnique({
    where: { id: discussionId },
    include: {
      author: { select: USER_SELECT },
      replies: { include: { author: { select: USER_SELECT } }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!disc) { sendNotFound(res, 'Discussion'); return; }
  if (!(await ownProject(disc.projectId, userId))) { sendForbidden(res); return; }
  sendSuccess(res, disc);
}

export async function replyToDiscussion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { discussionId } = req.params;
  if (!(await requireAddon(userId, res))) return;

  const disc = await prisma.pMDiscussion.findUnique({ where: { id: discussionId }, select: { projectId: true } });
  if (!disc) { sendNotFound(res, 'Discussion'); return; }
  if (!(await ownProject(disc.projectId, userId))) { sendForbidden(res); return; }

  const { content } = req.body;
  if (!content?.trim()) { sendError(res, 'Content is required'); return; }

  const reply = await prisma.pMDiscussionReply.create({
    data: { discussionId, authorId: userId, content: content.trim() },
    include: { author: { select: USER_SELECT } },
  });
  res.status(201).json({ success: true, message: 'Reply added', data: reply });
}

export async function deleteDiscussion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { discussionId } = req.params;
  const disc = await prisma.pMDiscussion.findUnique({ where: { id: discussionId }, select: { projectId: true, authorId: true } });
  if (!disc) { sendNotFound(res, 'Discussion'); return; }
  if (disc.authorId !== userId) { sendForbidden(res); return; }
  if (!(await requireAddon(userId, res))) return;
  await prisma.pMDiscussion.delete({ where: { id: discussionId } });
  sendSuccess(res, null, 'Discussion deleted');
}

export async function deleteDiscussionReply(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { replyId } = req.params;
  const reply = await prisma.pMDiscussionReply.findUnique({ where: { id: replyId }, select: { authorId: true } });
  if (!reply) { sendNotFound(res, 'Reply'); return; }
  if (reply.authorId !== userId) { sendForbidden(res); return; }
  await prisma.pMDiscussionReply.delete({ where: { id: replyId } });
  sendSuccess(res, null, 'Reply deleted');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILES
// ═══════════════════════════════════════════════════════════════════════════

export async function listFiles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const files = await prisma.pMFile.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: USER_SELECT } },
  });
  sendSuccess(res, files);
}

export async function addFile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const { name, url, size, mimeType } = req.body;
  if (!name?.trim() || !url?.trim()) { sendError(res, 'Name and URL are required'); return; }

  const file = await prisma.pMFile.create({
    data: {
      projectId,
      uploadedById: userId,
      name: name.trim(),
      url: url.trim(),
      size: size ? parseInt(size) : null,
      mimeType: mimeType || null,
    },
    include: { uploadedBy: { select: USER_SELECT } },
  });
  res.status(201).json({ success: true, message: 'File added', data: file });
}

export async function deleteFile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { fileId } = req.params;
  const file = await prisma.pMFile.findUnique({ where: { id: fileId }, select: { uploadedById: true } });
  if (!file) { sendNotFound(res, 'File'); return; }
  if (file.uploadedById !== userId) { sendForbidden(res); return; }
  await prisma.pMFile.delete({ where: { id: fileId } });
  sendSuccess(res, null, 'File removed');
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export async function listTimeEntries(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const entries = await prisma.pMTimeEntry.findMany({
    where: { projectId },
    orderBy: { logDate: 'desc' },
    include: {
      user: { select: USER_SELECT },
      task: { select: { id: true, title: true } },
    },
  });

  const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  sendSuccess(res, {
    entries,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
  });
}

export async function logTime(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { id: projectId } = req.params;
  if (!(await requireAddon(userId, res))) return;
  if (!(await ownProject(projectId, userId))) { sendForbidden(res); return; }

  const { taskId, description, minutes, logDate } = req.body;
  const mins = parseInt(minutes);
  if (!mins || mins < 1) { sendError(res, 'Minutes must be at least 1'); return; }

  const entry = await prisma.pMTimeEntry.create({
    data: {
      projectId,
      userId,
      taskId: taskId || null,
      description: description?.trim() || null,
      minutes: mins,
      logDate: logDate ? new Date(logDate) : new Date(),
    },
    include: {
      user: { select: USER_SELECT },
      task: { select: { id: true, title: true } },
    },
  });
  res.status(201).json({ success: true, message: 'Time logged', data: entry });
}

export async function deleteTimeEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { entryId } = req.params;
  const entry = await prisma.pMTimeEntry.findUnique({ where: { id: entryId }, select: { userId: true } });
  if (!entry) { sendNotFound(res, 'Time entry'); return; }
  if (entry.userId !== userId) { sendForbidden(res); return; }
  await prisma.pMTimeEntry.delete({ where: { id: entryId } });
  sendSuccess(res, null, 'Time entry deleted');
}
