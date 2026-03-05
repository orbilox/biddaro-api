import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  openDispute, getMyDisputes, getDispute, respondToDispute, resolveDispute,
} from '../controllers/disputes.controller';

const router = Router();

router.get('/', authenticate, getMyDisputes);
router.post('/', authenticate, validate([
  body('contractId').notEmpty().withMessage('Contract ID is required'),
  body('reason').notEmpty().withMessage('Reason is required'),
  body('description').trim().isLength({ min: 20 }).withMessage('Description must be at least 20 characters'),
]), openDispute);
router.get('/:id', authenticate, getDispute);
router.post('/:id/respond', authenticate, validate([
  body('response').trim().isLength({ min: 10 }).withMessage('Response must be at least 10 characters'),
]), respondToDispute);
router.post('/:id/resolve', authenticate, validate([
  body('resolution').notEmpty().withMessage('Resolution is required'),
]), resolveDispute);

export default router;
