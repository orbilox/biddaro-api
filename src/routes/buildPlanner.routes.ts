import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listPlans, createPlan, getPlan, updatePlan, deletePlan,
  addSection, updateSection, deleteSection,
  toggleCheckItem, addCheckItem, deleteCheckItem,
  listMedia, addMedia, deleteMedia,
  getAchievements,
} from '../controllers/buildPlanner.controller';

const router = Router();

// ── Plans ─────────────────────────────────────────────────────────────────────
router.get('/plans',                              authenticate, listPlans);
router.post('/plans',                             authenticate, createPlan);
router.get('/plans/:id',                          authenticate, getPlan);
router.put('/plans/:id',                          authenticate, updatePlan);
router.delete('/plans/:id',                       authenticate, deletePlan);

// ── Sections ──────────────────────────────────────────────────────────────────
router.post('/plans/:planId/sections',            authenticate, addSection);
router.put('/sections/:sectionId',                authenticate, updateSection);
router.delete('/sections/:sectionId',             authenticate, deleteSection);

// ── Check items ───────────────────────────────────────────────────────────────
router.post('/sections/:sectionId/items',         authenticate, addCheckItem);
router.put('/items/:itemId/toggle',               authenticate, toggleCheckItem);
router.delete('/items/:itemId',                   authenticate, deleteCheckItem);

// ── Media ─────────────────────────────────────────────────────────────────────
router.get('/plans/:planId/media',                authenticate, listMedia);
router.post('/plans/:planId/media',               authenticate, addMedia);
router.delete('/media/:mediaId',                  authenticate, deleteMedia);

// ── Achievements ──────────────────────────────────────────────────────────────
router.get('/plans/:planId/achievements',         authenticate, getAchievements);

export default router;
