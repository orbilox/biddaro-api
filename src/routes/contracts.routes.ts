import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  getMyContracts, getContract, updateMilestones, completeMilestone,
  completeContract, cancelContract,
} from '../controllers/contracts.controller';

const router = Router();

router.get('/', authenticate, getMyContracts);
router.get('/:id', authenticate, getContract);
router.put('/:id/milestones', authenticate, validate([
  body('milestones').isArray().withMessage('Milestones must be an array'),
]), updateMilestones);
router.post('/:id/milestones/complete', authenticate, validate([
  body('milestoneIndex').isInt({ min: 0 }).withMessage('Valid milestone index is required'),
]), completeMilestone);
router.post('/:id/complete', authenticate, completeContract);
router.post('/:id/cancel', authenticate, cancelContract);

export default router;
