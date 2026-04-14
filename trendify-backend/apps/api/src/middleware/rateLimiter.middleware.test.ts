// Feature: trendify-backend-cms, Property 28: Rate limit enforcement
// Feature: trendify-backend-cms, Property 29: Rate limit headers invariant

import crypto from 'crypto';

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY;
process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY;
process.env.STRAPI_WEBHOOK_SECRET = 'test-secret';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.WEBHOOK_URL = 'http://localhost:3000/webhooks/strapi';

jest.mock('../lib/prisma', () => ({ prisma: {} }));

const mockZAdd = jest.fn();
const mockZRemRangeByScore = jest.fn();
const mockExpire = jest.fn();
const mockZCard = jest.fn();

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    zadd: mockZAdd,
    zremrangebyscore: mockZRemRangeByScore,
    expire: mockExpire,
    zcard: mockZCard,
  }));
});

import * as fc from 'fast-check';
import request from 'supertest';
import express, { Router } from 'express';
import { rateLimiterMiddleware } from './rateLimiter.middleware';
import { correlationMiddleware } from './correlation.middleware';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(correlationMiddleware);
  app.use(rateLimiterMiddleware);
  const router = Router();
  router.get('/test', (_req, res) => res.json({ ok: true }));
  app.use(router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockZAdd.mockResolvedValue(1);
  mockZRemRangeByScore.mockResolvedValue(0);
  mockExpire.mockResolvedValue(1);
});

// ---------------------------------------------------------------------------
// Property 28: Rate limit enforcement
// Validates: Requirements 11.1, 11.2, 11.3
// ---------------------------------------------------------------------------
describe('Property 28: Rate limit enforcement', () => {
  it('requests within limit (count ≤ 100) return 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (count) => {
          mockZCard.mockResolvedValue(count);
          const app = buildApp();
          const res = await request(app).get('/test');
          expect(res.status).toBe(200);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('requests exceeding limit (count > 100) return 429 with Retry-After', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 500 }),
        async (count) => {
          mockZCard.mockResolvedValue(count);
          const app = buildApp();
          const res = await request(app).get('/test');
          expect(res.status).toBe(429);
          expect(res.body.message).toBe('Too many requests');
          expect(res.headers['retry-after']).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 29: Rate limit headers invariant
// Validates: Requirements 11.4
// ---------------------------------------------------------------------------
describe('Property 29: Rate limit headers invariant', () => {
  it('every response includes X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 200 }),
        async (count) => {
          mockZCard.mockResolvedValue(count);
          const app = buildApp();
          const res = await request(app).get('/test');
          expect(res.headers['x-ratelimit-limit']).toBeDefined();
          expect(res.headers['x-ratelimit-remaining']).toBeDefined();
          expect(res.headers['x-ratelimit-reset']).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });
});
