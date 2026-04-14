import crypto from 'crypto';

export default {
  /**
   * Strapi v5 lifecycle hook configuration for webhook emission.
   * The actual webhook URL and secret are read from environment variables.
   * This file documents the expected configuration.
   */
  webhooks: {
    populateRelations: false,
  },
};
