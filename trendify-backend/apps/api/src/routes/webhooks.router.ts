import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { upsertFromWebhook } from '../services/trend.service';
import { logger } from '../utils/logger';
import { StrapiWebhookPayload } from '../types/trend';

const router = Router();

function verifySignature(payload: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', env.STRAPI_WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post('/strapi', async (req: Request, res: Response) => {
  const signature = req.headers['x-strapi-signature'] as string | undefined;
  const rawBody = JSON.stringify(req.body);

  if (!signature || !verifySignature(rawBody, signature)) {
    return void res.status(401).json({ message: 'Unauthorized' });
  }

  const payload = req.body as StrapiWebhookPayload;

  try {
    await upsertFromWebhook(payload);
    res.status(200).json({ message: 'ok' });
  } catch (err) {
    logger.error({
      message: 'Webhook processing failed',
      payload,
      error: err instanceof Error ? err.message : String(err),
      correlationId: req.correlationId,
    });
    // Return 500 so Strapi retries delivery
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
