import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getMyBids, acceptBid, declineBid, withdrawBid,
} from '../controllers/bids.controller';

const router = Router();

router.get('/my', authenticate, getMyBids);
router.post('/:id/accept', authenticate, acceptBid);
router.post('/:id/decline', authenticate, declineBid);
router.post('/:id/withdraw', authenticate, withdrawBid);

export default router;
