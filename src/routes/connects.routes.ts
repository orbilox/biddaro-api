import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getConnectPackages,
  getMyConnects,
  createConnectOrder,
  verifyAndCreditConnects,
} from '../controllers/connects.controller';

const router = Router();

// Public — anyone can see available packages (e.g. before signup)
router.get('/packages', getConnectPackages);

// Contractor-only routes
router.get('/',         authenticate, requireRole('contractor'), getMyConnects);
router.post('/order',   authenticate, requireRole('contractor'), createConnectOrder);
router.post('/purchase', authenticate, requireRole('contractor'), verifyAndCreditConnects);

export default router;
