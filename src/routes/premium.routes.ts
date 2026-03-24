import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getPremiumStatus,
  subscribePremium,
  cancelPremium,
  getPremiumHistory,
} from '../controllers/premium.controller';

const router = Router();

// All premium routes require authentication
router.use(authenticate);

router.get('/status', getPremiumStatus);
router.post('/subscribe', subscribePremium);
router.post('/cancel', cancelPremium);
router.get('/history', getPremiumHistory);

export default router;
