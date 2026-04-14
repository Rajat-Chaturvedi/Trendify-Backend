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

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import * as authService from './auth.service';

// Typed mock helpers
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockUserCreate = prisma.user.create as jest.Mock;
const mockRefreshTokenCreate = prisma.refreshToken.create as jest.Mock;
const mockRefreshTokenFindUnique = prisma.refreshToken.findUnique as jest.Mock;
const mockRefreshTokenUpdate = prisma.refreshToken.update as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Property 6: Registration creates a user with hashed password
// Validates: Requirements 2.1, 2.6
// ---------------------------------------------------------------------------
describe('Property 6: Registration creates a user with hashed password', () => {
  it('should store a bcrypt hash, never the plaintext password', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 8, maxLength: 20 }).filter((s) => s.length >= 8),
        async (email, password) => {
          jest.clearAllMocks();

          const userId = uuidv4();
          mockUserFindUnique.mockResolvedValue(null);
          mockUserCreate.mockImplementation(async ({ data }: { data: { email: string; passwordHash: string } }) => ({
            id: userId,
            email: data.email,
            passwordHash: data.passwordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));
          mockRefreshTokenCreate.mockResolvedValue({
            id: uuidv4(),
            token: uuidv4(),
            userId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date(),
          });

          await authService.register(email, password);

          expect(mockUserCreate).toHaveBeenCalledTimes(1);
          const callArg = mockUserCreate.mock.calls[0][0] as { data: { passwordHash: string } };
          const { passwordHash } = callArg.data;

          // Must not store plaintext
          expect(passwordHash).not.toBe(password);
          // Must be a valid bcrypt hash
          expect(passwordHash).toMatch(/^\$2[aby]\$/);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Short password rejection
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------
describe('Property 7: Short password rejection', () => {
  it('should reject passwords shorter than 8 characters with statusCode 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ maxLength: 7 }),
        async (email, shortPassword) => {
          jest.clearAllMocks();

          await expect(authService.register(email, shortPassword)).rejects.toMatchObject({
            statusCode: 400,
          });

          // Prisma should never be called for short passwords
          expect(mockUserCreate).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Token expiry invariants
// Validates: Requirements 2.7, 2.8
// ---------------------------------------------------------------------------
describe('Property 9: Token expiry invariants', () => {
  it('should issue access tokens with exp - iat === 900 (15 minutes)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 8, maxLength: 20 }).filter((s) => s.length >= 8),
        async (email, password) => {
          jest.clearAllMocks();

          const userId = uuidv4();
          mockUserFindUnique.mockResolvedValue(null);
          mockUserCreate.mockImplementation(async ({ data }: { data: { email: string; passwordHash: string } }) => ({
            id: userId,
            email: data.email,
            passwordHash: data.passwordHash,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));
          mockRefreshTokenCreate.mockResolvedValue({
            id: uuidv4(),
            token: uuidv4(),
            userId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date(),
          });

          const { accessToken } = await authService.register(email, password);

          const decoded = jwt.decode(accessToken) as { iat: number; exp: number } | null;
          expect(decoded).not.toBeNull();
          expect(decoded!.exp - decoded!.iat).toBe(900);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Refresh token rotation
// Validates: Requirements 3.1, 3.2
// ---------------------------------------------------------------------------
describe('Property 10: Refresh token rotation', () => {
  it('should revoke the old refresh token and return a new one on refresh', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (userId, oldTokenValue) => {
          jest.clearAllMocks();

          const storedTokenId = uuidv4();
          const newTokenValue = uuidv4();

          mockRefreshTokenFindUnique.mockResolvedValue({
            id: storedTokenId,
            token: oldTokenValue,
            userId,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            user: {
              id: userId,
              email: `user-${userId}@example.com`,
              passwordHash: 'hashed',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });

          mockRefreshTokenUpdate.mockResolvedValue({
            id: storedTokenId,
            token: oldTokenValue,
            userId,
            revokedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          });

          mockRefreshTokenCreate.mockResolvedValue({
            id: uuidv4(),
            token: newTokenValue,
            userId,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            createdAt: new Date(),
          });

          const result = await authService.refresh(oldTokenValue);

          // New tokens must be returned
          expect(result.accessToken).toBeTruthy();
          expect(result.refreshToken).toBeTruthy();

          // Old token must be revoked
          expect(mockRefreshTokenUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { id: storedTokenId },
              data: { revokedAt: expect.any(Date) },
            }),
          );

          // New refresh token must differ from old one
          expect(result.refreshToken).not.toBe(oldTokenValue);
        },
      ),
      { numRuns: 20 },
    );
  });
});
