// Feature: trendify-backend-cms, Property 13: Protected route authentication enforcement
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
  verifyAccessToken: jest.fn(),
}));
jest.mock('../lib/prisma', () => ({ prisma: {} }));

import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './auth.middleware';
import { verifyAccessToken } from '../services/auth.service';
import { UnauthorizedError } from '../errors/AppError';

const mockVerify = verifyAccessToken as jest.Mock;

function makeReq(authHeader?: string): Partial<Request> {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Partial<Request>;
}

function makeRes(): { status: jest.Mock; json: jest.Mock; statusCode: number } {
  const res = { statusCode: 200 } as any;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('Property 13: Protected route authentication enforcement', () => {
  it('valid Bearer token → req.user set and next() called', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.emailAddress(), async (userId, email) => {
        mockVerify.mockResolvedValue({ sub: userId, email, iat: 0, exp: 9999999999 });
        const req = makeReq(`Bearer some-token`) as Request;
        const res = makeRes() as unknown as Response;
        const next = jest.fn() as NextFunction;

        await authMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toEqual({ id: userId, email });
        expect(res.status).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it('missing Authorization header → 401 "Authentication required"', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(undefined), async () => {
        const req = makeReq() as Request;
        const res = makeRes() as unknown as Response;
        const next = jest.fn() as NextFunction;

        await authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' });
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it('invalid/expired token → 401 "Invalid or expired token"', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (badToken) => {
        mockVerify.mockRejectedValue(new UnauthorizedError('Invalid or expired token'));
        const req = makeReq(`Bearer ${badToken}`) as Request;
        const res = makeRes() as unknown as Response;
        const next = jest.fn() as NextFunction;

        await authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });
});
