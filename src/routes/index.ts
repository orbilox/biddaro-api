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

export default router;
