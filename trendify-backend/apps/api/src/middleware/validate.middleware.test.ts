// Feature: trendify-backend-cms, Property 26: Validation error response shape
// Feature: trendify-backend-cms, Property 27: Unhandled exception response safety

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

import * as fc from 'fast-check';
import request from 'supertest';
import express, { Router } from 'express';
import { z } from 'zod';
import { validate } from './validate.middleware';
import { errorHandler } from './errorHandler.middleware';
import { correlationMiddleware } from './correlation.middleware';

function buildApp(schema: z.ZodSchema, throwUnhandled = false) {
  const app = express();
  app.use(express.json());
  app.use(correlationMiddleware);
  const router = Router();
  if (throwUnhandled) {
    router.post('/test', (_req, _res, next) => {
      next(new Error('Unexpected internal failure with stack trace details'));
    });
  } else {
    router.post('/test', validate(schema), (_req, res) => {
      res.json({ ok: true });
    });
  }
  app.use(router);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Property 26: Validation error response shape
// Validates: Requirements 10.2
// ---------------------------------------------------------------------------
describe('Property 26: Validation error response shape', () => {
  it('any invalid body returns 400 with message string and errors array', async () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().positive(),
    });
    const app = buildApp(schema);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.oneof(fc.constant(''), fc.constant(undefined), fc.integer()),
          age: fc.oneof(fc.constant(-1), fc.constant(0), fc.string()),
        }),
        async (invalidBody) => {
          const res = await request(app).post('/test').send(invalidBody);
          expect(res.status).toBe(400);
          expect(typeof res.body.message).toBe('string');
          expect(Array.isArray(res.body.errors)).toBe(true);
          expect(res.body.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 27: Unhandled exception response safety
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------
describe('Property 27: Unhandled exception response safety', () => {
  it('unhandled exception returns 500 with generic message and no stack trace', async () => {
    const app = buildApp(z.object({}), true);

    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const res = await request(app).post('/test').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Internal server error');
        // Must not expose stack trace, file paths, or internal details
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toMatch(/at\s+\w+\s+\(/); // no stack frames
        expect(bodyStr).not.toMatch(/\.ts:/);
        expect(bodyStr).not.toMatch(/\.js:/);
      }),
      { numRuns: 20 },
    );
  });
});
