// Feature: trendify-backend-cms, Property 24: Webhook HMAC validation
// Feature: trendify-backend-cms, Property 25: Webhook upsert correctness

import crypto from 'crypto';

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const TEST_WEBHOOK_SECRET = 'test-webhook-secret-32chars-long!!';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY;
process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY;
process.env.STRAPI_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.WEBHOOK_URL = 'http://localhost:3000/webhooks/strapi';

jest.mock('../services/trend.service', () => ({
  listTrends: jest.fn(),
  getTrendById: jest.fn(),
  upsertFromWebhook: jest.fn(),
}));
jest.mock('../services/auth.service', () => ({ verifyAccessToken: jest.fn() }));
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userPreferences: { findUnique: jest.fn(), upsert: jest.fn() },
    pushToken: { upsert: jest.fn() },
    trendItem: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
    bookmark: { create: jest.fn(), delete: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  },
}));
jest.mock('../lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheDel: jest.fn().mockResolvedValue(undefined),
  getRedisClient: jest.fn(),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  zadd: jest.fn().mockResolvedValue(1),
  zremrangebyscore: jest.fn().mockResolvedValue(0),
  expire: jest.fn().mockResolvedValue(1),
  zcard: jest.fn().mockResolvedValue(1),
})));

import * as fc from 'fast-check';
import request from 'supertest';
import { createApp } from '../app';
import * as trendService from '../services/trend.service';

const mockUpsert = trendService.upsertFromWebhook as jest.Mock;
const app = createApp();

function sign(body: string): string {
  return crypto.createHmac('sha256', TEST_WEBHOOK_SECRET).update(body).digest('hex');
}

const VALID_PAYLOAD = {
  event: 'entry.publish',
  model: 'trend-item',
  entry: {
    id: 1,
    title: 'Test Trend',
    description: 'A test trend',
    source: 'Test Source',
    publishedAt: '2024-01-01T00:00:00Z',
    url: 'https://example.com',
    category: 'technology',
    regionCode: null,
    locale: 'en',
  },
};

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Property 24: Webhook HMAC validation — Validates: Requirements 9.4
// ---------------------------------------------------------------------------
describe('Property 24: Webhook HMAC validation', () => {
  it('valid HMAC signature → 200 and payload processed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(VALID_PAYLOAD), async (payload) => {
        mockUpsert.mockResolvedValue({ id: 'item-1' });
        const body = JSON.stringify(payload);
        const sig = sign(body);

        const res = await request(app)
          .post('/webhooks/strapi')
          .set('Content-Type', 'application/json')
          .set('X-Strapi-Signature', sig)
          .send(payload);

        expect(res.status).toBe(200);
        expect(mockUpsert).toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it('invalid HMAC signature → 401 and payload NOT processed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 64 }),
        async (badSig) => {
          const res = await request(app)
            .post('/webhooks/strapi')
            .set('Content-Type', 'application/json')
            .set('X-Strapi-Signature', badSig)
            .send(VALID_PAYLOAD);

          expect(res.status).toBe(401);
          expect(mockUpsert).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  it('missing signature header → 401', async () => {
    const res = await request(app)
      .post('/webhooks/strapi')
      .send(VALID_PAYLOAD);
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 25: Webhook upsert correctness — Validates: Requirements 9.2
// ---------------------------------------------------------------------------
describe('Property 25: Webhook upsert correctness', () => {
  it('valid webhook payload → upsertFromWebhook called with the payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('technology', 'sports', 'finance', 'entertainment', 'health', 'science'),
        fc.constantFrom('en', 'fr', 'de'),
        async (category, locale) => {
          const payload = {
            ...VALID_PAYLOAD,
            entry: { ...VALID_PAYLOAD.entry, category, locale },
          };
          mockUpsert.mockResolvedValue({ id: 'item-1' });
          const body = JSON.stringify(payload);
          const sig = sign(body);

          const res = await request(app)
            .post('/webhooks/strapi')
            .set('Content-Type', 'application/json')
            .set('X-Strapi-Signature', sig)
            .send(payload);

          expect(res.status).toBe(200);
          expect(mockUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
              entry: expect.objectContaining({ category, locale }),
            }),
          );
        },
      ),
      { numRuns: 20 },
    );
  });

  it('processing failure → 500 so Strapi retries', async () => {
    mockUpsert.mockRejectedValue(new Error('DB error'));
    const body = JSON.stringify(VALID_PAYLOAD);
    const sig = sign(body);

    const res = await request(app)
      .post('/webhooks/strapi')
      .set('Content-Type', 'application/json')
      .set('X-Strapi-Signature', sig)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(500);
  });
});
