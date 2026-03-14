import { Router } from 'express';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import {
  getMyContracts, getContract, updateMilestones,
  fundEscrow, fundMilestoneEscrow,
  startMilestone, submitMilestone, approveMilestone,
  completeContract, cancelContract, issueNOC, getNOC,
} from '../controllers/contracts.controller';
import {
  listClarifications, createClarification, answerClarification,
} from '../controllers/clarifications.controller';

const router = Router();

router.get('/',    authenticate, getMyContracts);
router.get('/:id', authenticate, getContract);

// ─── Escrow ───────────────────────────────────────────────────────────────────
// Full upfront:   POST /:id/fund              body: (none)
// Per-milestone:  POST /:id/fund-milestone    body: { milestoneIndex: number }
router.post('/:id/fund',          authenticate, fundEscrow);
router.post('/:id/fund-milestone', authenticate, validate([
  body('milestoneIndex').isInt({ min: 0 }).withMessage('Valid milestone index is required'),
]), fundMilestoneEscrow);

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

// ─── NOC Certificate ──────────────────────────────────────────────────────────
router.post('/:id/noc', authenticate, issueNOC);
router.get('/:id/noc',  authenticate, getNOC);

// ─── Clarifications ───────────────────────────────────────────────────────────
router.get('/:id/clarifications',   authenticate, listClarifications);
router.post('/:id/clarifications',  authenticate, validate([
  body('question').trim().notEmpty().withMessage('Question is required'),
]), createClarification);
router.put('/:id/clarifications/:clarificationId/answer', authenticate, validate([
  body('answer').trim().notEmpty().withMessage('Answer is required'),
]), answerClarification);

export default router;
