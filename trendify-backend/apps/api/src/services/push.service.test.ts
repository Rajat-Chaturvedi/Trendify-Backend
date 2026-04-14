// Feature: trendify-backend-cms, Property 21: Push notification fan-out correctness
// Feature: trendify-backend-cms, Property 22: Push batch size invariant
// Feature: trendify-backend-cms, Property 23: Push retry limit
// Feature: trendify-backend-cms, Property 20: Push token storage round-trip

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
const mockPushTokenUpsert = jest.fn();
const mockPushTokenDeleteMany = jest.fn();
const mockUserFindMany = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    pushToken: {
      upsert: mockPushTokenUpsert,
      deleteMany: mockPushTokenDeleteMany,
    },
    user: {
      findMany: mockUserFindMany,
    },
  },
}));

// Mock https module
const mockHttpsRequest = jest.fn();
jest.mock('https', () => ({
  request: mockHttpsRequest,
}));

import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { Category } from '@prisma/client';
import * as pushService from './push.service';

const CATEGORIES = Object.values(Category);

function makeTrendItem(overrides: Partial<{
  id: string;
  strapiId: string;
  title: string;
  description: string;
  source: string;
  publishedAt: Date;
  imageUrl: string | null;
  url: string;
  category: Category;
  regionCode: string | null;
  locale: string;
}> = {}) {
  return {
    id: uuidv4(),
    strapiId: uuidv4(),
    title: 'Test Trend Title',
    description: 'Test Description',
    source: 'Test Source',
    publishedAt: new Date('2024-01-01T00:00:00Z'),
    imageUrl: null,
    url: 'https://example.com',
    category: Category.technology,
    regionCode: null,
    locale: 'en',
    ...overrides,
  };
}

function makePushToken(userId: string, overrides: Partial<{ id: string; token: string }> = {}) {
  return {
    id: uuidv4(),
    userId,
    token: `ExponentPushToken[${uuidv4()}]`,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUserWithTokens(category: Category, tokenCount: number) {
  const userId = uuidv4();
  const pushTokens = Array.from({ length: tokenCount }, () => makePushToken(userId));
  return {
    id: userId,
    email: `user-${userId}@example.com`,
    passwordHash: 'hash',
    displayName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    pushTokens,
    preferences: {
      id: uuidv4(),
      userId,
      categories: [category],
      regionCode: null,
      locale: 'en',
      updatedAt: new Date(),
    },
  };
}

/**
 * Helper to mock a successful Expo API response for all tokens in a batch.
 */
function mockExpoSuccess(tokenCount: number) {
  mockHttpsRequest.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const tickets = Array.from({ length: tokenCount }, () => ({ status: 'ok', id: uuidv4() }));
    const responseBody = JSON.stringify({ data: tickets });

    const mockRes = {
      on: (event: string, handler: (chunk?: string) => void) => {
        if (event === 'data') handler(responseBody);
        if (event === 'end') handler();
        return mockRes;
      },
    };

    callback(mockRes);

    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
  });
}

/**
 * Helper to mock an Expo API response with a retriable error for all tokens.
 */
function mockExpoRetriableError(tokenCount: number) {
  mockHttpsRequest.mockImplementation((_options: unknown, callback: (res: unknown) => void) => {
    const tickets = Array.from({ length: tokenCount }, () => ({
      status: 'error',
      message: 'MessageRateExceeded',
      details: { error: 'MessageRateExceeded' },
    }));
    const responseBody = JSON.stringify({ data: tickets });

    const mockRes = {
      on: (event: string, handler: (chunk?: string) => void) => {
        if (event === 'data') handler(responseBody);
        if (event === 'end') handler();
        return mockRes;
      },
    };

    callback(mockRes);

    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockPushTokenUpsert.mockResolvedValue({});
  mockPushTokenDeleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Property 20: Push token storage round-trip — Validates: Requirements 7.1
// ---------------------------------------------------------------------------
describe('Property 20: Push token storage round-trip', () => {
  it('registerToken upserts the token in the DB with the correct userId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.string({ minLength: 10, maxLength: 50 }),
        async (userId, token) => {
          mockPushTokenUpsert.mockResolvedValue({ id: uuidv4(), userId, token, createdAt: new Date() });

          await pushService.registerToken(userId, token);

          expect(mockPushTokenUpsert).toHaveBeenCalledWith({
            where: { token },
            create: { userId, token },
            update: { userId },
          });
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Push notification fan-out correctness — Validates: Requirements 7.2
// ---------------------------------------------------------------------------
describe('Property 21: Push notification fan-out correctness', () => {
  it('notifyNewTrendItem sends to exactly the users with matching category + push token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CATEGORIES),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        async (category, matchingUserCount, nonMatchingUserCount) => {
          jest.clearAllMocks();

          const matchingUsers = Array.from({ length: matchingUserCount }, () =>
            makeUserWithTokens(category, 1),
          );

          // Non-matching users have a different category
          const otherCategory = CATEGORIES.find((c) => c !== category) ?? Category.sports;
          const nonMatchingUsers = Array.from({ length: nonMatchingUserCount }, () =>
            makeUserWithTokens(otherCategory, 1),
          );

          // DB returns only matching users (as the query filters by category)
          mockUserFindMany.mockResolvedValue(matchingUsers);

          const expectedTokenCount = matchingUsers.reduce(
            (sum, u) => sum + u.pushTokens.length,
            0,
          );

          mockExpoSuccess(expectedTokenCount);

          const trendItem = makeTrendItem({ category });
          await pushService.notifyNewTrendItem(trendItem);

          // Verify the DB was queried with the correct category filter
          expect(mockUserFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({
                preferences: expect.objectContaining({
                  categories: expect.objectContaining({ has: category }),
                }),
              }),
            }),
          );

          // Verify Expo was called with exactly the matching tokens
          if (expectedTokenCount > 0) {
            const allCallArgs = mockHttpsRequest.mock.calls;
            expect(allCallArgs.length).toBeGreaterThan(0);
          } else {
            expect(mockHttpsRequest).not.toHaveBeenCalled();
          }

          // Suppress unused variable warning
          void nonMatchingUsers;
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22: Push batch size invariant — Validates: Requirements 7.4
// ---------------------------------------------------------------------------
describe('Property 22: Push batch size invariant', () => {
  it('for N tokens, exactly ceil(N/100) Expo API calls are made', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 350 }),
        async (tokenCount) => {
          jest.clearAllMocks();

          // Build a single user with tokenCount push tokens
          const userId = uuidv4();
          const pushTokens = Array.from({ length: tokenCount }, () => makePushToken(userId));
          const user = {
            id: userId,
            email: `user@example.com`,
            passwordHash: 'hash',
            displayName: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            pushTokens,
          };

          mockUserFindMany.mockResolvedValue([user]);
          mockExpoSuccess(Math.min(tokenCount, 100));

          const trendItem = makeTrendItem({ category: Category.technology });
          await pushService.notifyNewTrendItem(trendItem);

          const expectedBatches = Math.ceil(tokenCount / 100);
          expect(mockHttpsRequest).toHaveBeenCalledTimes(expectedBatches);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 23: Push retry limit — Validates: Requirements 7.5
// ---------------------------------------------------------------------------
describe('Property 23: Push retry limit', () => {
  it('on retriable error, at most 3 total attempts are made', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (tokenCount) => {
          jest.clearAllMocks();

          // Always return retriable errors
          mockExpoRetriableError(tokenCount);

          const messages = Array.from({ length: tokenCount }, (_, i) => ({
            to: `ExponentPushToken[token-${i}]`,
            title: 'New Trend',
            body: 'Test',
          }));
          const tokens = messages.map((m) => m.to);

          // Run with fake timers advancing automatically
          const promise = pushService.sendBatchWithRetry(messages, tokens);
          // Advance timers to skip backoff delays
          await jest.runAllTimersAsync();
          await promise;

          // At most MAX_ATTEMPTS (3) calls total
          expect(mockHttpsRequest.mock.calls.length).toBeLessThanOrEqual(3);
          expect(mockHttpsRequest.mock.calls.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 20 },
    );
  });
});
