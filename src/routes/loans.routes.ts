import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  applyLoan, myLoanApplications, getLoanApplication,
  adminListLoans, adminReviewLoan, adminLoanStats,
} from '../controllers/loans.controller';
import { createLoanOrder, applyLoanPaid } from '../controllers/razorpayLoans.controller';

const router = Router();

// ─── India Razorpay fee routes (must be before /:id) ──────────────────────────
router.post('/india/order', createLoanOrder);  // public — no auth needed before payment
router.post('/india/apply', authenticate, applyLoanPaid);

// ─── User routes ──────────────────────────────────────────────────────────────
router.post('/', authenticate, applyLoan);
router.get('/my', authenticate, myLoanApplications);
router.get('/:id', authenticate, getLoanApplication);

// ─── Admin routes ─────────────────────────────────────────────────────────────
router.get('/admin/stats', authenticate, requireRole('admin'), adminLoanStats);
router.get('/admin/all', authenticate, requireRole('admin'), adminListLoans);
router.patch('/admin/:id/review', authenticate, requireRole('admin'), adminReviewLoan);

export default router;
