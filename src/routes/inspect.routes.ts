import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  // Dashboard
  getDashboardStats,
  // Templates
  listTemplates, createTemplate, getTemplate, updateTemplate, deleteTemplate,
  // Projects
  listProjects, createProject, getProject, updateProject, deleteProject,
  // Captures
  listCaptures, addCapture, updateCapture, deleteCapture,
  // Reports
  generateReport, listReports, getReport, updateReport, deleteReport, sendReport, exportReportDocx, exportReportPdf,
  // Captioning
  captionCapture,
  // Portfolio search
  searchPortfolio,
  // Tasks
  listTasks, createTask, updateTask, deleteTask,
} from '../controllers/inspect.controller';

const router = Router();

// All inspect routes require authentication
router.use(authenticate);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard',  getDashboardStats);
router.post('/search',    searchPortfolio);

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
router.put('/projects/:id/captures/:cid',           updateCapture);
router.delete('/projects/:id/captures/:cid',        deleteCapture);
router.post('/projects/:id/captures/:cid/caption',  captionCapture);

// ── Reports ───────────────────────────────────────────────────────────────────
router.post('/projects/:id/reports/generate', generateReport);   // AI generation
router.get('/projects/:id/reports',           listReports);
router.get('/reports/:id',                    getReport);
router.put('/reports/:id',                    updateReport);
router.delete('/reports/:id',                 deleteReport);
router.post('/reports/:id/send',              sendReport);
router.get('/reports/:id/export/docx',        exportReportDocx);
router.get('/reports/:id/export/pdf',         exportReportPdf);

// ── Tasks ─────────────────────────────────────────────────────────────────────
router.get('/reports/:id/tasks',    listTasks);
router.post('/reports/:id/tasks',   createTask);
router.put('/tasks/:tid',           updateTask);
router.delete('/tasks/:tid',        deleteTask);

export default router;
