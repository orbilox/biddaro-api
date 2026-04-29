import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getMyReferralInfo, getReferralStats } from '../controllers/referral.controller';

const router = Router();

router.get('/my', authenticate, getMyReferralInfo);
router.get('/stats', authenticate, getReferralStats);

export default router;
