import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listProjects, createProject, updateProject, deleteProject, getProjectOverview,
  listTasks, createTask, updateTask, deleteTask,
  listMilestones, createMilestone, updateMilestone, deleteMilestone,
  listDiscussions, createDiscussion, getDiscussion, replyToDiscussion, deleteDiscussion, deleteDiscussionReply,
  listFiles, addFile, deleteFile,
  listTimeEntries, logTime, deleteTimeEntry,
} from '../controllers/pm.controller';

const router = Router();

// ── Projects ──────────────────────────────────────────────────────────────────
router.get('/projects',              authenticate, listProjects);
router.post('/projects',             authenticate, createProject);
router.get('/projects/:id/overview', authenticate, getProjectOverview);
router.put('/projects/:id',          authenticate, updateProject);
router.delete('/projects/:id',       authenticate, deleteProject);

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/projects/:id/tasks',    authenticate, listTasks);
router.post('/projects/:id/tasks',   authenticate, createTask);
router.put('/tasks/:taskId',         authenticate, updateTask);
router.delete('/tasks/:taskId',      authenticate, deleteTask);

// ── Milestones ────────────────────────────────────────────────────────────────
router.get('/projects/:id/milestones',        authenticate, listMilestones);
router.post('/projects/:id/milestones',       authenticate, createMilestone);
router.put('/milestones/:milestoneId',        authenticate, updateMilestone);
router.delete('/milestones/:milestoneId',     authenticate, deleteMilestone);

// ── Discussions ───────────────────────────────────────────────────────────────
router.get('/projects/:id/discussions',                   authenticate, listDiscussions);
router.post('/projects/:id/discussions',                  authenticate, createDiscussion);
router.get('/discussions/:discussionId',                  authenticate, getDiscussion);
router.post('/discussions/:discussionId/replies',         authenticate, replyToDiscussion);
router.delete('/discussions/:discussionId',               authenticate, deleteDiscussion);
router.delete('/discussion-replies/:replyId',             authenticate, deleteDiscussionReply);

// ── Files ─────────────────────────────────────────────────────────────────────
router.get('/projects/:id/files',    authenticate, listFiles);
router.post('/projects/:id/files',   authenticate, addFile);
router.delete('/files/:fileId',      authenticate, deleteFile);

// ── Time Tracking ─────────────────────────────────────────────────────────────
router.get('/projects/:id/time',     authenticate, listTimeEntries);
router.post('/projects/:id/time',    authenticate, logTime);
router.delete('/time/:entryId',      authenticate, deleteTimeEntry);

export default router;
