import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  getWallet, getTransactions, deposit, withdraw, getWalletStats,
} from '../controllers/wallet.controller';

const router = Router();

router.get('/', authenticate, getWallet);
router.get('/stats', authenticate, getWalletStats);
router.get('/transactions', authenticate, getTransactions);

router.post('/deposit', authenticate, validate([
  body('amount').isFloat({ min: 10 }).withMessage('Minimum deposit is $10'),
  body('paymentMethod').optional().isString(),
]), deposit);

router.post('/withdraw', authenticate, validate([
  body('amount').isFloat({ min: 20 }).withMessage('Minimum withdrawal is $20'),
  body('bankAccount').optional().isString(),
]), withdraw);

export default router;
