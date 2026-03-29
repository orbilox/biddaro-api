import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './users.routes';
import jobRoutes from './jobs.routes';
import bidRoutes from './bids.routes';
import contractRoutes from './contracts.routes';
import messageRoutes from './messages.routes';
import walletRoutes from './wallet.routes';
import disputeRoutes from './disputes.routes';
import reviewRoutes from './reviews.routes';
import notificationRoutes from './notifications.routes';
import uploadRoutes from './upload.routes';
import aiRoutes from './ai.routes';
import imageGenRoutes from './image-gen.routes';
import depositRequestRoutes from './depositRequests.routes';
import bankSettingsRoutes from './bankSettings.routes';
import adminRoutes from './admin.routes';
import premiumRoutes from './premium.routes';
import addonsRoutes from './addons.routes';
import projectTrackingRoutes from './projectTracking.routes';

const router = Router();

// ─── API root ─────────────────────────────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Biddaro API v1',
    endpoints: [
      '/api/v1/auth',
      '/api/v1/users',
      '/api/v1/jobs',
      '/api/v1/bids',
      '/api/v1/contracts',
      '/api/v1/messages',
      '/api/v1/wallet',
      '/api/v1/disputes',
      '/api/v1/reviews',
      '/api/v1/notifications',
      '/api/v1/upload',
      '/api/v1/ai',
      '/api/v1/image-gen',
      '/api/v1/deposit-requests',
      '/api/v1/bank-settings',
      '/api/v1/admin',
      '/api/v1/premium',
      '/api/v1/addons',
      '/api/v1/project-tracking',
    ],
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/jobs', jobRoutes);
router.use('/bids', bidRoutes);
router.use('/contracts', contractRoutes);
router.use('/messages', messageRoutes);
router.use('/wallet', walletRoutes);
router.use('/disputes', disputeRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/upload', uploadRoutes);
router.use('/ai', aiRoutes);
router.use('/image-gen', imageGenRoutes);
router.use('/deposit-requests', depositRequestRoutes);
router.use('/bank-settings', bankSettingsRoutes);
router.use('/admin', adminRoutes);
router.use('/premium', premiumRoutes);
router.use('/addons', addonsRoutes);
router.use('/project-tracking', projectTrackingRoutes);

export default router;
