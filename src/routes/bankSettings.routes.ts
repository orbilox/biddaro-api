import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getBankSettings,
  adminGetBankSettings,
  adminCreateBankSettings,
  adminUpdateBankSettings,
  adminDeleteBankSettings,
} from '../controllers/bankSettings.controller';

const router = Router();

// Public (authenticated users) — for deposit page
router.get('/', authenticate, getBankSettings);

// Admin routes
router.get('/admin', authenticate, adminGetBankSettings);
router.post('/admin', authenticate, adminCreateBankSettings);
router.put('/admin/:id', authenticate, adminUpdateBankSettings);
router.delete('/admin/:id', authenticate, adminDeleteBankSettings);

export default router;
