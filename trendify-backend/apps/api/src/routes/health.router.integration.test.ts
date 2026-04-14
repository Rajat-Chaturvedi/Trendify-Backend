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

jest.mock('../services/health.service', () => ({
  liveness: jest.fn(),
  readiness: jest.fn(),
}));
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

import request from 'supertest';
import { createApp } from '../app';
import * as healthService from '../services/health.service';

const mockLiveness = healthService.liveness as jest.Mock;
const mockReadiness = healthService.readiness as jest.Mock;
const app = createApp();

beforeEach(() => jest.clearAllMocks());

describe('GET /health/live', () => {
  it('200 with { status: "ok" } when process is running', async () => {
    mockLiveness.mockReturnValue({ status: 'ok' });
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  it('200 with { status: "ok" } when DB is reachable', async () => {
    mockReadiness.mockResolvedValue({ status: 'ok' });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('503 with { status: "unavailable", reason: "database" } when DB is unreachable', async () => {
    mockReadiness.mockResolvedValue({ status: 'unavailable', reason: 'database' });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', reason: 'database' });
  });
});
