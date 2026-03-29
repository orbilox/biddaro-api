import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listAddOns,
  getInstalledAddOns,
  installAddOn,
  uninstallAddOn,
  checkAddOn,
} from '../controllers/addons.controller';

const router = Router();

router.get('/',          authenticate, listAddOns);
router.get('/installed', authenticate, getInstalledAddOns);
router.get('/:slug',     authenticate, checkAddOn);
router.post('/:slug/install',   authenticate, installAddOn);
router.delete('/:slug/uninstall', authenticate, uninstallAddOn);

export default router;
