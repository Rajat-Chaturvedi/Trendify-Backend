// Set env vars before any imports so env.ts loadEnv() succeeds
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

jest.mock('../services/auth.service', () => ({
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
}));
jest.mock('../lib/prisma', () => ({ prisma: {} }));

import request from 'supertest';
import * as authService from '../services/auth.service';
import { createApp } from '../app';
import { ConflictError, UnauthorizedError } from '../errors/AppError';

const mockRegister = authService.register as jest.Mock;
const mockLogin = authService.login as jest.Mock;
const mockRefresh = authService.refresh as jest.Mock;
const mockLogout = authService.logout as jest.Mock;

const app = createApp();

const FAKE_TOKENS = {
  accessToken: 'access.token.value',
  refreshToken: 'refresh-token-value',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// Validates: Requirements 2.1, 2.2, 2.3, 2.4
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/register', () => {
  it('201 with accessToken + refreshToken on valid input', async () => {
    mockRegister.mockResolvedValue(FAKE_TOKENS);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accessToken: FAKE_TOKENS.accessToken,
      refreshToken: FAKE_TOKENS.refreshToken,
    });
    expect(mockRegister).toHaveBeenCalledWith('user@example.com', 'password123');
  });

  it('409 "Email already registered" on duplicate email', async () => {
    mockRegister.mockRejectedValue(new ConflictError('Email already registered'));

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'existing@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ message: 'Email already registered' });
  });

  it('400 on password shorter than 8 characters (Zod validation)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'user@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('400 on invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// Validates: Requirements 2.5, 2.6
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  it('200 with accessToken + refreshToken on valid credentials', async () => {
    mockLogin.mockResolvedValue(FAKE_TOKENS);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accessToken: FAKE_TOKENS.accessToken,
      refreshToken: FAKE_TOKENS.refreshToken,
    });
    expect(mockLogin).toHaveBeenCalledWith('user@example.com', 'password123');
  });

  it('401 "Invalid credentials" on wrong password', async () => {
    mockLogin.mockRejectedValue(new UnauthorizedError('Invalid credentials'));

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'Invalid credentials' });
  });

  it('401 "Invalid credentials" on unknown email', async () => {
    mockLogin.mockRejectedValue(new UnauthorizedError('Invalid credentials'));

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'Invalid credentials' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// Validates: Requirements 3.1, 3.2, 3.3
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/refresh', () => {
  it('200 with new token pair on valid refresh token', async () => {
    const newTokens = {
      accessToken: 'new.access.token',
      refreshToken: 'new-refresh-token',
    };
    mockRefresh.mockResolvedValue(newTokens);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(newTokens);
    expect(mockRefresh).toHaveBeenCalledWith('valid-refresh-token');
  });

  it('401 "Invalid or expired refresh token" on expired/revoked token', async () => {
    mockRefresh.mockRejectedValue(new UnauthorizedError('Invalid or expired refresh token'));

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'expired-or-revoked-token' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ message: 'Invalid or expired refresh token' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// Validates: Requirements 3.4
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/logout', () => {
  it('204 on valid userId', async () => {
    mockLogout.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({ userId: 'user-id-123' });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(mockLogout).toHaveBeenCalledWith('user-id-123');
  });

  it('400 when userId missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: 'userId required' });
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
