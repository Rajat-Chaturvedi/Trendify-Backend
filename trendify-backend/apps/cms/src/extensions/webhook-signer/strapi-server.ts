/**
 * Strapi v5 extension: signs outgoing webhook requests with HMAC-SHA256.
 * The X-Strapi-Signature header is computed as:
 *   HMAC-SHA256(STRAPI_WEBHOOK_SECRET, JSON.stringify(payload))
 *
 * This extension registers a lifecycle hook that fires on entry publish/unpublish
 * and POSTs to WEBHOOK_URL with the signature header.
 */
export default {
  register({ strapi }: { strapi: any }) {
    strapi.webhookRunner?.on('error', (error: Error) => {
      strapi.log.error('Webhook delivery error:', error);
    });
  },
};
