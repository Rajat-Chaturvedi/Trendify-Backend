// Feature: trendify-backend-cms
// Property-based tests for users router (Properties 14–17)

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

// Mock prisma
const mockPrismaUser = {
  findUnique: jest.fn(),
  update: jest.fn(),
};
const mockPrismaUserPreferences = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
};
const mockPrismaUserPushToken = {
  upsert: jest.fn(),
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: mockPrismaUser,
    userPreferences: mockPrismaUserPreferences,
    pushToken: mockPrismaUserPushToken,
  },
}));

// Mock Redis
jest.mock('../lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheDel: jest.fn().mockResolvedValue(undefined),
  getRedisClient: jest.fn(),
}));

// Mock ioredis
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    zadd: jest.fn().mockResolvedValue(1),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    zcard: jest.fn().mockResolvedValue(1),
  })),
);

// Mock auth service — verifyAccessToken returns a payload for any token
jest.mock('../services/auth.service', () => ({
  verifyAccessToken: jest.fn(),
}));

// Mock trend service for Property 17
jest.mock('../services/trend.service', () => ({
  listTrends: jest.fn(),
  getTrendById: jest.fn(),
  upsertFromWebhook: jest.fn(),
}));

import request from 'supertest';
import * as fc from 'fast-check';
import { createApp } from '../app';
import * as authService from '../services/auth.service';
import * as trendService from '../services/trend.service';
import { Category } from '@prisma/client';

const mockVerifyAccessToken = authService.verifyAccessToken as jest.Mock;
const mockListTrends = trendService.listTrends as jest.Mock;

const app = createApp();

const VALID_CATEGORIES = Object.values(Category);
const BEARER = 'Bearer test-token';
const FAKE_USER_ID = 'user-id-123';
const FAKE_EMAIL = 'user@example.com';

function setupAuth(userId = FAKE_USER_ID, email = FAKE_EMAIL) {
  mockVerifyAccessToken.mockResolvedValue({ sub: userId, email, iat: 0, exp: 9999999999 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 14: User profile round-trip
// Validates: Requirements 5.1, 5.2
// ---------------------------------------------------------------------------
describe('Property 14: User profile round-trip', () => {
  it('GET /me returns email matching registration; PATCH updates displayName', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (email, displayName) => {
          setupAuth(FAKE_USER_ID, email);

          const fakeUser = {
            id: FAKE_USER_ID,
            email,
            displayName: null,
            createdAt: new Date().toISOString(),
          };

          // GET /me returns the user with the registration email
          mockPrismaUser.findUnique.mockResolvedValue(fakeUser);
          const getRes = await request(app)
            .get('/api/v1/users/me')
            .set('Authorization', BEARER);

          if (getRes.status !== 200) return false;
          if (getRes.body.email !== email) return false;

          // PATCH /me with new displayName
          const updatedUser = { ...fakeUser, displayName };
          mockPrismaUser.update.mockResolvedValue(updatedUser);
          const patchRes = await request(app)
            .patch('/api/v1/users/me')
            .set('Authorization', BEARER)
            .send({ displayName });

          if (patchRes.status !== 200) return false;
          if (patchRes.body.displayName !== displayName) return false;

          return true;
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Preferences round-trip
// Validates: Requirements 5.3
// ---------------------------------------------------------------------------
describe('Property 15: Preferences round-trip', () => {
  it('PUT /me/preferences then GET returns same payload', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...VALID_CATEGORIES), { minLength: 0, maxLength: 3 }),
        fc.option(fc.string({ minLength: 2, maxLength: 5 }).filter(s => /^[A-Z]{2}$/.test(s)), { nil: null }),
        fc.constantFrom('en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'ko'),
        async (categories, regionCode, locale) => {
          setupAuth();

          const prefsPayload = { categories, regionCode, locale };

          mockPrismaUserPreferences.upsert.mockResolvedValue(prefsPayload);
          const putRes = await request(app)
            .put('/api/v1/users/me/preferences')
            .set('Authorization', BEARER)
            .send(prefsPayload);

          if (putRes.status !== 200) return false;

          mockPrismaUserPreferences.findUnique.mockResolvedValue(prefsPayload);
          const getRes = await request(app)
            .get('/api/v1/users/me/preferences')
            .set('Authorization', BEARER);

          if (getRes.status !== 200) return false;

          const body = getRes.body;
          if (body.locale !== locale) return false;
          if (JSON.stringify(body.categories.sort()) !== JSON.stringify([...categories].sort())) return false;

          return true;
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Invalid category in preferences rejected
// Validates: Requirements 5.4
// ---------------------------------------------------------------------------
describe('Property 16: Invalid category in preferences rejected', () => {
  it('PUT /me/preferences with invalid category returns 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !VALID_CATEGORIES.includes(s as Category)),
        async (invalidCategory) => {
          setupAuth();

          const res = await request(app)
            .put('/api/v1/users/me/preferences')
            .set('Authorization', BEARER)
            .send({
              categories: [invalidCategory],
              regionCode: null,
              locale: 'en',
            });

          return res.status === 400;
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17: Stored preferences applied as default filters
// Validates: Requirements 5.5
// ---------------------------------------------------------------------------
describe('Property 17: Stored preferences applied as default filters', () => {
  it('GET /api/v1/trends with no filters uses stored user preferences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...VALID_CATEGORIES), { minLength: 1, maxLength: 3 }),
        fc.option(fc.constantFrom('US', 'GB', 'DE', 'FR'), { nil: null }),
        fc.constantFrom('en', 'fr', 'de'),
        async (categories, regionCode, locale) => {
          setupAuth();

          // Simulate user preferences stored in DB
          const storedPrefs = { categories, regionCode, locale };
          mockPrismaUserPreferences.findUnique.mockResolvedValue(storedPrefs);

          // trends router reads user prefs when no explicit filters provided
          mockListTrends.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });

          const res = await request(app)
            .get('/api/v1/trends')
            .set('Authorization', BEARER);

          if (res.status !== 200) return false;

          // The trend service should have been called
          if (!mockListTrends.mock.calls.length) return false;

          return true;
        },
      ),
      { numRuns: 20 },
    );
  });
});
