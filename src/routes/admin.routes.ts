import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getPlatformStats,
  getRevenueChart,
  getUserGrowthChart,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  adjustUserWallet,
  listJobs,
  getJob,
  adminUpdateJob,
  adminDeleteJob,
  listContracts,
  getContract,
  listTransactions,
  listAllDisputes,
  listAllReviews,
  adminDeleteReview,
  getRecentActivity,
  broadcastNotification,
} from '../controllers/admin.controller';
import {
  adminPremiumStats,
  adminPremiumList,
  adminPremiumRevenue,
} from '../controllers/premium.controller';
import { adminListLoanLeads } from '../controllers/loanLeads.controller';
import { adminPushStats } from '../controllers/pushStats.controller';
import {
  adminListSocialPosts,
  adminGenerateSocialPost,
  adminUpdateSocialPost,
  adminDeleteSocialPost,
  adminPlanMonth,
  adminGenerateSlot,
} from '../controllers/socialPosts.controller';

const router = Router();

// All admin routes require auth + admin role
router.use(authenticate, requireRole('admin'));

// ── Analytics ────────────────────────────────────────────────────────────────
router.get('/stats', getPlatformStats);
router.get('/revenue-chart', getRevenueChart);
router.get('/user-growth-chart', getUserGrowthChart);
router.get('/activity', getRecentActivity);

// ── User Management ──────────────────────────────────────────────────────────
router.get('/users', listUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/wallet-adjust', adjustUserWallet);

// ── Job Management ───────────────────────────────────────────────────────────
router.get('/jobs', listJobs);
router.get('/jobs/:id', getJob);
router.patch('/jobs/:id', adminUpdateJob);
router.delete('/jobs/:id', adminDeleteJob);

// ── Contract Management ──────────────────────────────────────────────────────
router.get('/contracts', listContracts);
router.get('/contracts/:id', getContract);

// ── Transaction Management ───────────────────────────────────────────────────
router.get('/transactions', listTransactions);

// ── Dispute Management ───────────────────────────────────────────────────────
router.get('/disputes', listAllDisputes);

// ── Review Management ────────────────────────────────────────────────────────
router.get('/reviews', listAllReviews);
router.delete('/reviews/:id', adminDeleteReview);

// ── Notifications ────────────────────────────────────────────────────────────
router.post('/broadcast', broadcastNotification);

// ── Loan Leads ───────────────────────────────────────────────────────────────
router.get('/loan-leads', adminListLoanLeads);

// ── Push Notifications ───────────────────────────────────────────────────────
router.get('/push-stats', adminPushStats);

// ── Social Posts ─────────────────────────────────────────────────────────────
router.get('/social-posts', adminListSocialPosts);
router.post('/social-posts/generate', adminGenerateSocialPost);
router.post('/social-posts/plan-month', adminPlanMonth);
router.post('/social-posts/:id/generate', adminGenerateSlot);
router.patch('/social-posts/:id', adminUpdateSocialPost);
router.delete('/social-posts/:id', adminDeleteSocialPost);

// ── Premium Management ────────────────────────────────────────────────────────
router.get('/premium/stats', adminPremiumStats);
router.get('/premium/subscriptions', adminPremiumList);
router.get('/premium/revenue', adminPremiumRevenue);

export default router;
