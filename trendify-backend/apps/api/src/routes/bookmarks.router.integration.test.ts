// Integration tests for bookmarks router
// Validates: Requirements 6.1–6.5

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

// Mock bookmark service
const mockAddBookmark = jest.fn();
const mockRemoveBookmark = jest.fn();
const mockListBookmarks = jest.fn();

jest.mock('../services/bookmark.service', () => ({
  addBookmark: mockAddBookmark,
  removeBookmark: mockRemoveBookmark,
  listBookmarks: mockListBookmarks,
}));

// Mock prisma
jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    userPreferences: { findUnique: jest.fn(), upsert: jest.fn() },
    pushToken: { upsert: jest.fn() },
    trendItem: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
    bookmark: { create: jest.fn(), delete: jest.fn(), findMany: jest.fn(), count: jest.fn() },
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

// Mock trend service
jest.mock('../services/trend.service', () => ({
  listTrends: jest.fn(),
  getTrendById: jest.fn(),
  upsertFromWebhook: jest.fn(),
}));

import request from 'supertest';
import { createApp } from '../app';
import * as authService from '../services/auth.service';
import { ConflictError, NotFoundError } from '../errors/AppError';

const mockVerifyAccessToken = authService.verifyAccessToken as jest.Mock;

const app = createApp();

const FAKE_USER_ID = 'user-id-abc';
const FAKE_EMAIL = 'test@example.com';
const BEARER = 'Bearer valid-token';
const TREND_ITEM_ID = 'trend-item-id-123';

const FAKE_TREND_ITEM = {
  id: TREND_ITEM_ID,
  strapiId: 'strapi-1',
  title: 'Test Trend',
  description: 'A test trend',
  source: 'Test Source',
  publishedAt: new Date('2024-01-01').toISOString(),
  imageUrl: null,
  url: 'https://example.com',
  category: 'technology',
  regionCode: null,
  locale: 'en',
};

const FAKE_PAGE = {
  items: [FAKE_TREND_ITEM],
  nextCursor: null,
  totalCount: 1,
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
// POST /api/v1/bookmarks/:trendItemId
// ---------------------------------------------------------------------------
describe('POST /api/v1/bookmarks/:trendItemId', () => {
  it('201 on success', async () => {
    setupAuth();
    mockAddBookmark.mockResolvedValue(undefined);

    const res = await request(app)
      .post(`/api/v1/bookmarks/${TREND_ITEM_ID}`)
      .set('Authorization', BEARER);

    expect(res.status).toBe(201);
    expect(mockAddBookmark).toHaveBeenCalledWith(FAKE_USER_ID, TREND_ITEM_ID);
  });

  it('409 "Already bookmarked" on duplicate', async () => {
    setupAuth();
    mockAddBookmark.mockRejectedValue(new ConflictError('Already bookmarked'));

    const res = await request(app)
      .post(`/api/v1/bookmarks/${TREND_ITEM_ID}`)
      .set('Authorization', BEARER);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Already bookmarked');
  });

  it('401 without token', async () => {
    const res = await request(app).post(`/api/v1/bookmarks/${TREND_ITEM_ID}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/bookmarks/:trendItemId
// ---------------------------------------------------------------------------
describe('DELETE /api/v1/bookmarks/:trendItemId', () => {
  it('204 on success', async () => {
    setupAuth();
    mockRemoveBookmark.mockResolvedValue(undefined);

    const res = await request(app)
      .delete(`/api/v1/bookmarks/${TREND_ITEM_ID}`)
      .set('Authorization', BEARER);

    expect(res.status).toBe(204);
    expect(mockRemoveBookmark).toHaveBeenCalledWith(FAKE_USER_ID, TREND_ITEM_ID);
  });

  it('404 on missing bookmark', async () => {
    setupAuth();
    mockRemoveBookmark.mockRejectedValue(new NotFoundError('Bookmark not found'));

    const res = await request(app)
      .delete(`/api/v1/bookmarks/${TREND_ITEM_ID}`)
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Bookmark not found');
  });

  it('401 without token', async () => {
    const res = await request(app).delete(`/api/v1/bookmarks/${TREND_ITEM_ID}`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/bookmarks
// ---------------------------------------------------------------------------
describe('GET /api/v1/bookmarks', () => {
  it('200 with paginated list', async () => {
    setupAuth();
    mockListBookmarks.mockResolvedValue(FAKE_PAGE);

    const res = await request(app)
      .get('/api/v1/bookmarks')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: TREND_ITEM_ID })]),
      nextCursor: null,
      totalCount: 1,
    });
    expect(mockListBookmarks).toHaveBeenCalledWith(FAKE_USER_ID, undefined, undefined);
  });

  it('200 with cursor and pageSize query params', async () => {
    setupAuth();
    mockListBookmarks.mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });

    const res = await request(app)
      .get('/api/v1/bookmarks?cursor=abc123&pageSize=5')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(mockListBookmarks).toHaveBeenCalledWith(FAKE_USER_ID, 'abc123', 5);
  });

  it('401 without token', async () => {
    const res = await request(app).get('/api/v1/bookmarks');
    expect(res.status).toBe(401);
  });
});
