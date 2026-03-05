import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getUserProfile, updateProfile, listContractors, getUserStats, deleteAccount,
} from '../controllers/users.controller';

const router = Router();

router.get('/contractors', listContractors);
router.get('/me/stats', authenticate, getUserStats);
router.put('/me', authenticate, updateProfile);
router.delete('/me', authenticate, deleteAccount);
router.get('/:id', getUserProfile);

export default router;
