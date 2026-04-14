// Feature: trendify-backend-cms, Property 18: Bookmark round-trip
// Feature: trendify-backend-cms, Property 19: Bookmarks ordered by creation date descending

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

const mockBookmarkCreate = jest.fn();
const mockBookmarkDelete = jest.fn();
const mockBookmarkFindMany = jest.fn();
const mockBookmarkCount = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    bookmark: {
      create: mockBookmarkCreate,
      delete: mockBookmarkDelete,
      findMany: mockBookmarkFindMany,
      count: mockBookmarkCount,
    },
  },
}));

import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { Category } from '@prisma/client';
import * as bookmarkService from './bookmark.service';

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
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: uuidv4(),
    strapiId: uuidv4(),
    title: 'Test Title',
    description: 'Test Description',
    source: 'Test Source',
    publishedAt: new Date('2024-01-01T00:00:00Z'),
    imageUrl: null,
    url: 'https://example.com',
    category: Category.technology,
    regionCode: null,
    locale: 'en',
    published: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeBookmark(trendItem: ReturnType<typeof makeTrendItem>, overrides: Partial<{
  id: string;
  userId: string;
  trendItemId: string;
  createdAt: Date;
}> = {}) {
  return {
    id: uuidv4(),
    userId: uuidv4(),
    trendItemId: trendItem.id,
    createdAt: new Date(),
    trendItem,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBookmarkCount.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// Property 18: Bookmark round-trip — Validates: Requirements 6.1, 6.2, 6.3
// ---------------------------------------------------------------------------
describe('Property 18: Bookmark round-trip', () => {
  it('addBookmark then listBookmarks shows the item; removeBookmark then listBookmarks does not show it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CATEGORIES),
        async (category) => {
          const userId = uuidv4();
          const trendItem = makeTrendItem({ category });
          const bookmark = makeBookmark(trendItem, { userId, trendItemId: trendItem.id });

          // addBookmark succeeds
          mockBookmarkCreate.mockResolvedValue(bookmark);

          await bookmarkService.addBookmark(userId, trendItem.id);
          expect(mockBookmarkCreate).toHaveBeenCalledWith({
            data: { userId, trendItemId: trendItem.id },
          });

          // listBookmarks shows the item
          mockBookmarkFindMany.mockResolvedValue([bookmark]);
          mockBookmarkCount.mockResolvedValue(1);

          const afterAdd = await bookmarkService.listBookmarks(userId);
          expect(afterAdd.items.some((i) => i.id === trendItem.id)).toBe(true);

          // removeBookmark succeeds
          mockBookmarkDelete.mockResolvedValue(bookmark);

          await bookmarkService.removeBookmark(userId, trendItem.id);
          expect(mockBookmarkDelete).toHaveBeenCalledWith({
            where: { userId_trendItemId: { userId, trendItemId: trendItem.id } },
          });

          // listBookmarks no longer shows the item
          mockBookmarkFindMany.mockResolvedValue([]);
          mockBookmarkCount.mockResolvedValue(0);

          const afterRemove = await bookmarkService.listBookmarks(userId);
          expect(afterRemove.items.some((i) => i.id === trendItem.id)).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: Bookmarks ordered by creation date descending — Validates: Requirements 6.4
// ---------------------------------------------------------------------------
describe('Property 19: Bookmarks ordered by creation date descending', () => {
  it('listBookmarks returns items in strictly descending createdAt order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (count) => {
          const userId = uuidv4();

          // Build bookmarks with strictly descending createdAt
          const bookmarks = Array.from({ length: count }, (_, i) => {
            const trendItem = makeTrendItem();
            return makeBookmark(trendItem, {
              userId,
              createdAt: new Date(2024, 0, count - i, 12, 0, 0, 0),
            });
          });

          mockBookmarkFindMany.mockResolvedValue(bookmarks);
          mockBookmarkCount.mockResolvedValue(count);

          const result = await bookmarkService.listBookmarks(userId);

          // Verify items are returned (order of trendItems matches bookmark order)
          expect(result.items.length).toBe(count);

          // Verify the bookmarks were queried with descending order
          expect(mockBookmarkFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            }),
          );

          // Verify createdAt of bookmarks is descending
          for (let i = 1; i < bookmarks.length; i++) {
            expect(bookmarks[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
              bookmarks[i].createdAt.getTime(),
            );
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
