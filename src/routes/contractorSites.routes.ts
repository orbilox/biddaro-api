import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth';
import {
  getPublicSite,
  getMySite,
  upsertMySite,
  createSiteLead,
  getMyLeads,
  subscribeSitePro,
  verifySitePro,
} from '../controllers/contractorSites.controller';

const router = Router();

// Public quote-request spam guard: 5 submissions / 10 min per IP
const leadRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests — please try again later.' },
});

// ── Owner endpoints (must be registered BEFORE /:slug) ───────────────────────
router.get('/me/site', authenticate, getMySite);
router.put('/me/site', authenticate, upsertMySite);
router.get('/me/leads', authenticate, getMyLeads);
router.post('/me/subscribe', authenticate, subscribeSitePro);
router.post('/me/verify', authenticate, verifySitePro);

// ── Public endpoints ──────────────────────────────────────────────────────────
router.get('/:slug', getPublicSite);
router.post('/:slug/lead', leadRateLimit, createSiteLead);

export default router;
