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

jest.mock('../services/trend.service', () => ({
  listTrends: jest.fn(),
  getTrendById: jest.fn(),
  upsertFromWebhook: jest.fn(),
}));
jest.mock('../lib/prisma', () => ({ prisma: {} }));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  zadd: jest.fn().mockResolvedValue(1),
  zremrangebyscore: jest.fn().mockResolvedValue(0),
  expire: jest.fn().mockResolvedValue(1),
  zcard: jest.fn().mockResolvedValue(1),
})));

import request from 'supertest';
import { createApp } from '../app';
import * as trendService from '../services/trend.service';
import { NotFoundError } from '../errors/AppError';
import { Category } from '@prisma/client';

const mockListTrends = trendService.listTrends as jest.Mock;
const mockGetTrendById = trendService.getTrendById as jest.Mock;

const app = createApp();

const FAKE_ITEM = {
  id: '00000000-0000-0000-0000-000000000001',
  strapiId: 'strapi-1',
  title: 'Test',
  description: 'Desc',
  source: 'Source',
  publishedAt: new Date('2024-01-01'),
  imageUrl: null,
  url: 'https://example.com',
  category: Category.technology,
  regionCode: null,
  locale: 'en',
};

const FAKE_PAGE = { items: [FAKE_ITEM], nextCursor: null, totalCount: 1 };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/trends', () => {
  it('200 with TrendItemPage and Content-Language header', async () => {
    mockListTrends.mockResolvedValue(FAKE_PAGE);
    const res = await request(app).get('/api/v1/trends');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.headers['content-language']).toBeDefined();
  });

  it('400 on pageSize out of range', async () => {
    const res = await request(app).get('/api/v1/trends?pageSize=0');
    expect(res.status).toBe(400);
  });

  it('400 on pageSize > 100', async () => {
    const res = await request(app).get('/api/v1/trends?pageSize=101');
    expect(res.status).toBe(400);
  });

  it('passes category filter to service', async () => {
    mockListTrends.mockResolvedValue(FAKE_PAGE);
    await request(app).get('/api/v1/trends?categories=technology,sports');
    expect(mockListTrends).toHaveBeenCalledWith(
      expect.objectContaining({ categories: ['technology', 'sports'] }),
    );
  });

  it('passes locale from Accept-Language header', async () => {
    mockListTrends.mockResolvedValue(FAKE_PAGE);
    await request(app).get('/api/v1/trends').set('Accept-Language', 'fr');
    expect(mockListTrends).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'fr' }),
    );
  });
});

describe('GET /api/v1/trends/:id', () => {
  it('200 with TrendItem and Content-Language header', async () => {
    mockGetTrendById.mockResolvedValue(FAKE_ITEM);
    const res = await request(app).get(`/api/v1/trends/${FAKE_ITEM.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(FAKE_ITEM.id);
    expect(res.headers['content-language']).toBe('en');
  });

  it('404 when item not found', async () => {
    mockGetTrendById.mockRejectedValue(new NotFoundError('Trend item not found'));
    const res = await request(app).get(`/api/v1/trends/${FAKE_ITEM.id}`);
    expect(res.status).toBe(404);
  });

  it('400 on invalid UUID param', async () => {
    const res = await request(app).get('/api/v1/trends/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
