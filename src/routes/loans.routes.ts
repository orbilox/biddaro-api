import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  applyLoan, myLoanApplications, getLoanApplication,
  adminListLoans, adminReviewLoan, adminLoanStats,
} from '../controllers/loans.controller';
import { createLoanOrder, applyLoanPaid, createSubscription } from '../controllers/razorpayLoans.controller';
import { submitInquiry, adminListInquiries, adminUpdateInquiry } from '../controllers/loanInquiries.controller';

const router = Router();

// ─── India Razorpay fee routes (must be before /:id) ──────────────────────────
router.post('/india/order',        createLoanOrder);           // public
router.post('/india/subscription', createSubscription);        // public
router.post('/india/inquiry',      submitInquiry);             // public — save lead immediately after payment
router.post('/india/apply',        authenticate, applyLoanPaid);

// ─── Admin inquiry routes ──────────────────────────────────────────────────────
router.get('/admin/inquiries',        authenticate, requireRole('admin'), adminListInquiries);
router.patch('/admin/inquiries/:id',  authenticate, requireRole('admin'), adminUpdateInquiry);

// ─── User routes ──────────────────────────────────────────────────────────────
router.post('/', authenticate, applyLoan);
router.get('/my', authenticate, myLoanApplications);
router.get('/:id', authenticate, getLoanApplication);

// ─── Admin routes ─────────────────────────────────────────────────────────────
router.get('/admin/stats', authenticate, requireRole('admin'), adminLoanStats);
router.get('/admin/all', authenticate, requireRole('admin'), adminListLoans);
router.patch('/admin/:id/review', authenticate, requireRole('admin'), adminReviewLoan);

export default router;
