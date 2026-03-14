import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createDepositRequest,
  getMyDepositRequests,
  adminListDepositRequests,
  adminReviewDepositRequest,
} from '../controllers/depositRequests.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── User routes ──────────────────────────────────────────────────────────────
router.post('/', createDepositRequest);
router.get('/my', getMyDepositRequests);

// ─── Admin routes ─────────────────────────────────────────────────────────────
router.get('/admin', adminListDepositRequests);
router.post('/admin/:id/review', adminReviewDepositRequest);

export default router;
