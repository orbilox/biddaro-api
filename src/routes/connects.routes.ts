import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getConnectPackages,
  getMyConnects,
  createConnectOrder,
  verifyAndCreditConnects,
  getConnectCostForJob,
  adminRefundJob,
  adminGetConnectStats,
} from '../controllers/connects.controller';

const router = Router();

// Public — anyone can see available packages (e.g. before signup)
router.get('/packages', getConnectPackages);

// Contractor-only routes
router.get('/',          authenticate, requireRole('contractor'), getMyConnects);
router.post('/order',    authenticate, requireRole('contractor'), createConnectOrder);
router.post('/purchase', authenticate, requireRole('contractor'), verifyAndCreditConnects);
router.get('/cost/:jobId', authenticate, requireRole('contractor'), getConnectCostForJob);

// Admin routes
router.get('/admin/stats',                  authenticate, requireRole('admin'), adminGetConnectStats);
router.post('/admin/refund-job/:jobId',     authenticate, requireRole('admin'), adminRefundJob);

export default router;
