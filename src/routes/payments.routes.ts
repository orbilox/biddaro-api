import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createCheckoutSession } from '../controllers/payments.controller';

const router = Router();

// Create a Stripe Checkout Session for wallet top-up
router.post(
  '/create-checkout-session',
  authenticate,
  validate([
    body('amount')
      .isFloat({ min: 10, max: 5000 })
      .withMessage('Amount must be between $10 and $5,000'),
  ]),
  createCheckoutSession,
);

export default router;
