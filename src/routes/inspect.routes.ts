import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import {
  // Dashboard
  getDashboardStats,
  // Templates
  listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate,
  // Projects
  listProjects, createProject, getProject, updateProject, deleteProject,
  // Captures
  listCaptures, addCapture, getCapture, updateCapture, deleteCapture,
  // Reports
  generateReport, listReports, listAllReports, getReport, updateReport, deleteReport, sendReport,
  exportReportDocx, exportReportPdf, importReport, listLanguages,
  // Client portal (public share)
  shareReport, unshareReport, getPublicReport,
  // Inspector settings
  getInspectSettings, upsertInspectSettings,
  // Analytics
  getInspectAnalytics,
  // Floor plans
  listFloorPlans, createFloorPlan, updateFloorPlan, deleteFloorPlan,
  // Review notes
  listReviewNotes, addReviewNote, deleteReviewNote,
  // Captioning
  captionCapture,
  // Portfolio search + comparison
  searchPortfolio, compareReports,
  // Tasks
  listTasks, createTask, updateTask, deleteTask,
  // Scheduling
  listSchedules, createSchedule, updateSchedule, deleteSchedule, listUpcomingSchedules,
} from '../controllers/inspect.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Public endpoints (no auth) ────────────────────────────────────────────────
router.get('/public/:token', getPublicReport);

// All other inspect routes require authentication
router.use(authenticate);

// ── Inspector Settings ────────────────────────────────────────────────────────
router.get('/settings',   getInspectSettings);
router.put('/settings',   upsertInspectSettings);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard',  getDashboardStats);
router.get('/analytics',  getInspectAnalytics);
router.post('/search',    searchPortfolio);
router.post('/compare',   compareReports);

// ── Templates ─────────────────────────────────────────────────────────────────
router.get('/templates',        listTemplates);
router.post('/templates',       createTemplate);
router.get('/templates/:id',    getTemplate);
router.put('/templates/:id',    updateTemplate);
router.delete('/templates/:id', deleteTemplate);

// ── Projects ──────────────────────────────────────────────────────────────────
router.get('/projects',         listProjects);
router.post('/projects',        createProject);
router.get('/projects/:id',     getProject);
router.put('/projects/:id',     updateProject);
router.delete('/projects/:id',  deleteProject);

// ── Captures (field observations per project) ─────────────────────────────────
router.get('/projects/:id/captures',          listCaptures);
router.post('/projects/:id/captures',         addCapture);
router.get('/projects/:id/captures/:cid',           getCapture);
router.put('/projects/:id/captures/:cid',           updateCapture);
router.delete('/projects/:id/captures/:cid',        deleteCapture);
router.post('/projects/:id/captures/:cid/caption',  captionCapture);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/languages',                       listLanguages);      // Multi-lingual support
router.get('/reports',                         listAllReports);     // All reports (cross-project)
router.post('/projects/:id/reports/generate', generateReport);   // AI generation
router.post('/projects/:id/reports/import',   upload.single('file'), importReport); // Legacy import
router.get('/projects/:id/reports',           listReports);
router.get('/reports/:id',                    getReport);
router.put('/reports/:id',                    updateReport);
router.delete('/reports/:id',                 deleteReport);
router.post('/reports/:id/send',              sendReport);
router.post('/reports/:id/share',             shareReport);    // enable public link
router.delete('/reports/:id/share',           unshareReport);  // disable public link
router.get('/reports/:id/export/docx',        exportReportDocx);
router.get('/reports/:id/export/pdf',         exportReportPdf);

// ── Floor plans ───────────────────────────────────────────────────────────────
router.get('/projects/:id/floor-plans',        listFloorPlans);
router.post('/projects/:id/floor-plans',       createFloorPlan);
router.put('/floor-plans/:fid',                updateFloorPlan);
router.delete('/floor-plans/:fid',             deleteFloorPlan);

// ── Review notes (audit trail) ────────────────────────────────────────────────
router.get('/reports/:id/review/notes',    listReviewNotes);
router.post('/reports/:id/review/notes',   addReviewNote);
router.delete('/review/notes/:nid',        deleteReviewNote);

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/reports/:id/tasks',    listTasks);
router.post('/reports/:id/tasks',   createTask);
router.put('/tasks/:tid',           updateTask);
router.delete('/tasks/:tid',        deleteTask);

// ── Schedules ─────────────────────────────────────────────────────────────────
router.get('/schedules/upcoming',                listUpcomingSchedules);
router.get('/projects/:projectId/schedules',     listSchedules);
router.post('/projects/:projectId/schedules',    createSchedule);
router.put('/schedules/:sid',                    updateSchedule);
router.delete('/schedules/:sid',                 deleteSchedule);

export default router;
