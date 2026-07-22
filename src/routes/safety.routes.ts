import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTopics,
  getDefaultTemplates,
  listSites,
  createSite,
  getSite,
  updateSite,
  deleteSite,
  listSiteTalks,
  createTalk,
  listAllTalks,
  getTalk,
  deleteTalk,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listSiteAudits,
  createAudit,
  getAudit,
  updateAudit,
  completeAudit,
  deleteAudit,
  createAuditActions,
  listHazards,
  createHazard,
  getHazard,
  updateHazard,
  deleteHazard,
  getDashboard,
  getSettings,
  updateSettings,
} from '../controllers/safety.controller';

const router = Router();

// All Safety endpoints require auth (no public surface in MVP)
router.use(authenticate);

// ── Content library ──────────────────────────────────────────────────────────
router.get('/topics', getTopics);
router.get('/audit-template-defaults', getDefaultTemplates);

// ── Dashboard / settings ─────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

// ── Custom templates ─────────────────────────────────────────────────────────
router.get('/templates', listTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

// ── Talks (cross-site + detail) ──────────────────────────────────────────────
router.get('/talks', listAllTalks);
router.get('/talks/:id', getTalk);
router.delete('/talks/:id', deleteTalk);

// ── Audits (detail) ──────────────────────────────────────────────────────────
router.get('/audits/:id', getAudit);
router.put('/audits/:id', updateAudit);
router.post('/audits/:id/complete', completeAudit);
router.post('/audits/:id/actions', createAuditActions);
router.delete('/audits/:id', deleteAudit);

// ── Hazards (cross-site + detail) ────────────────────────────────────────────
router.get('/hazards', listHazards);
router.get('/hazards/:id', getHazard);
router.put('/hazards/:id', updateHazard);
router.delete('/hazards/:id', deleteHazard);

// ── Sites + nested creation ──────────────────────────────────────────────────
router.get('/sites', listSites);
router.post('/sites', createSite);
router.get('/sites/:id', getSite);
router.put('/sites/:id', updateSite);
router.delete('/sites/:id', deleteSite);
router.get('/sites/:id/talks', listSiteTalks);
router.post('/sites/:id/talks', createTalk);
router.get('/sites/:id/audits', listSiteAudits);
router.post('/sites/:id/audits', createAudit);
router.post('/sites/:id/hazards', createHazard);

export default router;
