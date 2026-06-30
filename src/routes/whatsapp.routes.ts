import { Router } from 'express';
import { verifyWhatsAppWebhook, receiveWhatsAppWebhook } from '../controllers/whatsapp.controller';

const router = Router();

// Meta WhatsApp Cloud API webhook (public — verified by WHATSAPP_VERIFY_TOKEN / 200-fast).
router.get('/webhook', verifyWhatsAppWebhook);
router.post('/webhook', receiveWhatsAppWebhook);

export default router;
