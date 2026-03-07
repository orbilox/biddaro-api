import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  getMyContracts, getContract, updateMilestones,
  fundEscrow, startMilestone, submitMilestone, approveMilestone,
  completeContract, cancelContract,
} from '../controllers/contracts.controller';

const router = Router();

router.get('/',    authenticate, getMyContracts);
router.get('/:id', authenticate, getContract);

// ─── Escrow ───────────────────────────────────────────────────────────────────
router.post('/:id/fund', authenticate, fundEscrow);

// ─── Milestones ───────────────────────────────────────────────────────────────
router.put('/:id/milestones', authenticate, validate([
  body('milestones').isArray().withMessage('Milestones must be an array'),
]), updateMilestones);

router.post('/:id/milestones/start', authenticate, validate([
  body('milestoneIndex').isInt({ min: 0 }).withMessage('Valid milestone index is required'),
]), startMilestone);

router.post('/:id/milestones/submit', authenticate, validate([
  body('milestoneIndex').isInt({ min: 0 }).withMessage('Valid milestone index is required'),
]), submitMilestone);

router.post('/:id/milestones/approve', authenticate, validate([
  body('milestoneIndex').isInt({ min: 0 }).withMessage('Valid milestone index is required'),
]), approveMilestone);

// ─── Contract lifecycle ───────────────────────────────────────────────────────
router.post('/:id/complete', authenticate, completeContract);
router.post('/:id/cancel',   authenticate, cancelContract);

export default router;
