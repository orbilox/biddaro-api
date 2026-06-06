import { Router, Request } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types';
import {
  getConnectPackages,
  getMyConnects,
  createConnectOrder,
  verifyAndCreditConnects,
  getConnectCostForJob,
  adminRefundJob,
  adminGetConnectStats,
  adminGrantConnects,
} from '../controllers/connects.controller';

const router = Router();

// Per-user rate limit for payment endpoints (10 attempts / 15 min per userId, not per IP).
// Applied AFTER authenticate so req.user is already populated by the key generator.
const purchaseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => (req as AuthenticatedRequest).user?.userId ?? req.ip ?? 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'development',
  message: { success: false, message: 'Too many payment attempts. Please try again in 15 minutes.' },
});

// Public — anyone can see available packages (e.g. before signup)
router.get('/packages', getConnectPackages);

// Contractor-only routes
router.get('/',            authenticate, requireRole('contractor'), getMyConnects);
router.post('/order',      authenticate, requireRole('contractor'), purchaseLimiter, createConnectOrder);
router.post('/purchase',   authenticate, requireRole('contractor'), purchaseLimiter, verifyAndCreditConnects);
router.get('/cost/:jobId', authenticate, requireRole('contractor'), getConnectCostForJob);

// Admin routes
router.get('/admin/stats',              authenticate, requireRole('admin'), adminGetConnectStats);
router.post('/admin/refund-job/:jobId', authenticate, requireRole('admin'), adminRefundJob);
router.post('/admin/grant/:userId',     authenticate, requireRole('admin'), adminGrantConnects);

export default router;
