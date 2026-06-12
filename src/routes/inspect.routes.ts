import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import {
  // Dashboard
  getDashboardStats,
  // Templates
  listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate,
  // Projects
  listProjects, createProject, getProject, updateProject, deleteProject, cloneProject,
  // Captures
  listCaptures, addCapture, getCapture, updateCapture, deleteCapture, deleteCaptureById,
  // Reports
  generateReport, listReports, listAllReports, getReport, updateReport, deleteReport, sendReport,
  exportReportDocx, exportReportPdf, exportCertificate, importReport, listLanguages,
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
  listTasks, listAllTasks, createTask, updateTask, deleteTask,
  // Scheduling
  listSchedules, createSchedule, updateSchedule, deleteSchedule, listUpcomingSchedules,
  // Versioning
  listVersions, restoreVersion,
  // Client signature
  signPublicReport,
  // Inspector e-signature
  signReport, clearInspectorSignature,
  // Bulk export
  bulkExportReports,
  // AI trend summary
  generateTrendSummary,
  // Schedule reminders
  triggerScheduleReminders,
  // Section feedback
  submitSectionFeedback, listSectionFeedback,
  // Webhooks
  listWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook,
  // Team members
  listProjectMembers, addProjectMember, updateProjectMember, removeProjectMember,
  // Client portal
  enableClientPortal, disableClientPortal, getClientPortal,
} from '../controllers/inspect.controller';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Public endpoints (no auth) ────────────────────────────────────────────────
router.get('/public/:token',                getPublicReport);
router.post('/public/:token/sign',          signPublicReport);
router.post('/public/:token/feedback',      submitSectionFeedback); // client section reactions
router.get('/client-portal/:token',         getClientPortal);       // project-level client portal

// All other inspect routes require authentication
router.use(authenticate);

// ── Inspector Settings ────────────────────────────────────────────────────────
router.get('/settings',   getInspectSettings);
router.put('/settings',   upsertInspectSettings);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard',  getDashboardStats);
router.get('/analytics',       getInspectAnalytics);
router.post('/analytics/trend', generateTrendSummary);
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
router.get('/projects/:id',          getProject);
router.put('/projects/:id',          updateProject);
router.delete('/projects/:id',       deleteProject);
router.post('/projects/:id/clone',   cloneProject);

// ── Captures (field observations per project) ─────────────────────────────────
router.get('/projects/:id/captures',          listCaptures);
router.post('/projects/:id/captures',         addCapture);
router.get('/projects/:id/captures/:cid',           getCapture);
router.put('/projects/:id/captures/:cid',           updateCapture);
router.delete('/projects/:id/captures/:cid',        deleteCapture);
router.post('/projects/:id/captures/:cid/caption',  captionCapture);
// Mobile shortcut — delete by capture ID only (ownership verified via project)
router.delete('/captures/:id',                deleteCaptureById);

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
router.post('/reports/:id/sign',              signReport);          // inspector e-signature
router.delete('/reports/:id/sign',            clearInspectorSignature); // remove inspector signature
router.get('/reports/:id/feedback',           listSectionFeedback); // client section reactions
router.get('/reports/:id/export/docx',        exportReportDocx);
router.get('/reports/:id/export/pdf',         exportReportPdf);
router.get('/reports/:id/export/certificate', exportCertificate);

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
router.get('/tasks',                listAllTasks);
router.get('/reports/:id/tasks',    listTasks);
router.post('/reports/:id/tasks',   createTask);
router.put('/tasks/:tid',           updateTask);
router.delete('/tasks/:tid',        deleteTask);

// ── Schedules ─────────────────────────────────────────────────────────────────
router.get('/schedules/upcoming',                listUpcomingSchedules);
router.post('/schedules/reminders',              triggerScheduleReminders);
router.get('/projects/:projectId/schedules',     listSchedules);
router.post('/projects/:projectId/schedules',    createSchedule);
router.put('/schedules/:sid',                    updateSchedule);
router.delete('/schedules/:sid',                 deleteSchedule);

// ── Bulk export ───────────────────────────────────────────────────────────────
router.post('/reports/bulk-export',          bulkExportReports);

// ── Report versioning ─────────────────────────────────────────────────────────
router.get('/reports/:id/versions',          listVersions);
router.post('/reports/:id/versions/:vid/restore', restoreVersion);

// ── Webhooks ──────────────────────────────────────────────────────────────────
router.get('/webhooks',               listWebhooks);
router.post('/webhooks',              createWebhook);
router.put('/webhooks/:id',           updateWebhook);
router.delete('/webhooks/:id',        deleteWebhook);
router.post('/webhooks/:id/test',     testWebhook);

// ── Project team members ───────────────────────────────────────────────────────
router.get('/projects/:id/members',       listProjectMembers);
router.post('/projects/:id/members',      addProjectMember);
router.put('/projects/:id/members/:mid',  updateProjectMember);
router.delete('/projects/:id/members/:mid', removeProjectMember);

// ── Client portal ─────────────────────────────────────────────────────────────
router.post('/projects/:id/client-portal',   enableClientPortal);
router.delete('/projects/:id/client-portal', disableClientPortal);

export default router;
