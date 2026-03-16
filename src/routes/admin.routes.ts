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

export default router;
