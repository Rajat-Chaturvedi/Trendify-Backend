// Integration tests for users router
// Validates: Requirements 5.1–5.5, 7.1, 19.9–19.11

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

// Mock auth service
jest.mock('../services/auth.service', () => ({
  verifyAccessToken: jest.fn(),
}));

// Mock trend service (needed because app.ts imports trends router)
jest.mock('../services/trend.service', () => ({
  listTrends: jest.fn(),
  getTrendById: jest.fn(),
  upsertFromWebhook: jest.fn(),
}));

import request from 'supertest';
import { createApp } from '../app';
import * as authService from '../services/auth.service';
import * as redisLib from '../lib/redis';

const mockVerifyAccessToken = authService.verifyAccessToken as jest.Mock;
const mockCacheDel = redisLib.cacheDel as jest.Mock;

const app = createApp();

const FAKE_USER_ID = 'user-id-abc';
const FAKE_EMAIL = 'test@example.com';
const BEARER = 'Bearer valid-token';

const FAKE_USER = {
  id: FAKE_USER_ID,
  email: FAKE_EMAIL,
  displayName: 'Test User',
  createdAt: new Date('2024-01-01').toISOString(),
};

const FAKE_PREFS = {
  categories: ['technology', 'sports'],
  regionCode: 'US',
  locale: 'en',
};

function setupAuth() {
  mockVerifyAccessToken.mockResolvedValue({
    sub: FAKE_USER_ID,
    email: FAKE_EMAIL,
    iat: 0,
    exp: 9999999999,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/me
// ---------------------------------------------------------------------------
describe('GET /api/v1/users/me', () => {
  it('200 with UserProfile for authenticated user', async () => {
    setupAuth();
    mockPrismaUser.findUnique.mockResolvedValue(FAKE_USER);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: FAKE_USER_ID,
      email: FAKE_EMAIL,
      displayName: 'Test User',
    });
    expect(res.body.createdAt).toBeDefined();
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('401 with invalid token', async () => {
    mockVerifyAccessToken.mockRejectedValue(new Error('Invalid token'));
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/users/me
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/users/me', () => {
  it('200 with updated displayName', async () => {
    setupAuth();
    const updated = { ...FAKE_USER, displayName: 'New Name' };
    mockPrismaUser.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', BEARER)
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('New Name');
    expect(mockPrismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: FAKE_USER_ID },
        data: { displayName: 'New Name' },
      }),
    );
  });

  it('400 with empty displayName', async () => {
    setupAuth();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', BEARER)
      .send({ displayName: '' });

    expect(res.status).toBe(400);
  });

  it('401 without token', async () => {
    const res = await request(app)
      .patch('/api/v1/users/me')
      .send({ displayName: 'Name' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/me/preferences
// ---------------------------------------------------------------------------
describe('GET /api/v1/users/me/preferences', () => {
  it('200 with stored preferences', async () => {
    setupAuth();
    mockPrismaUserPreferences.findUnique.mockResolvedValue(FAKE_PREFS);

    const res = await request(app)
      .get('/api/v1/users/me/preferences')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(FAKE_PREFS);
  });

  it('200 with defaults when no preferences stored', async () => {
    setupAuth();
    mockPrismaUserPreferences.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/users/me/preferences')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ categories: [], regionCode: null, locale: 'en' });
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/v1/users/me/preferences');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/users/me/preferences
// ---------------------------------------------------------------------------
describe('PUT /api/v1/users/me/preferences', () => {
  it('200 with valid payload', async () => {
    setupAuth();
    mockPrismaUserPreferences.upsert.mockResolvedValue(FAKE_PREFS);

    const res = await request(app)
      .put('/api/v1/users/me/preferences')
      .set('Authorization', BEARER)
      .send(FAKE_PREFS);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(FAKE_PREFS);
    expect(mockCacheDel).toHaveBeenCalledWith(`user:prefs:${FAKE_USER_ID}`);
  });

  it('400 with invalid BCP 47 locale', async () => {
    setupAuth();
    const res = await request(app)
      .put('/api/v1/users/me/preferences')
      .set('Authorization', BEARER)
      .send({ categories: ['technology'], regionCode: null, locale: 'not-valid-locale!!!' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Validation error');
  });

  it('400 with invalid category', async () => {
    setupAuth();
    const res = await request(app)
      .put('/api/v1/users/me/preferences')
      .set('Authorization', BEARER)
      .send({ categories: ['invalid_category'], regionCode: null, locale: 'en' });

    expect(res.status).toBe(400);
  });

  it('400 with multiple invalid categories', async () => {
    setupAuth();
    const res = await request(app)
      .put('/api/v1/users/me/preferences')
      .set('Authorization', BEARER)
      .send({ categories: ['technology', 'notreal'], regionCode: null, locale: 'en' });

    expect(res.status).toBe(400);
  });

  it('401 without token', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/preferences')
      .send(FAKE_PREFS);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/users/me/push-token
// ---------------------------------------------------------------------------
describe('POST /api/v1/users/me/push-token', () => {
  it('201 on success', async () => {
    setupAuth();
    mockPrismaUserPushToken.upsert.mockResolvedValue({ id: 'pt-1', userId: FAKE_USER_ID, token: 'ExponentPushToken[xxx]' });

    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .set('Authorization', BEARER)
      .send({ token: 'ExponentPushToken[xxx]' });

    expect(res.status).toBe(201);
    expect(mockPrismaUserPushToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { token: 'ExponentPushToken[xxx]' },
        create: { userId: FAKE_USER_ID, token: 'ExponentPushToken[xxx]' },
      }),
    );
  });

  it('400 with missing token', async () => {
    setupAuth();
    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .set('Authorization', BEARER)
      .send({});

    expect(res.status).toBe(400);
  });

  it('401 without token', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/push-token')
      .send({ token: 'ExponentPushToken[xxx]' });
    expect(res.status).toBe(401);
  });
});
