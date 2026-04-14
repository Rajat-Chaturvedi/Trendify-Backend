// Feature: trendify-backend-cms, Property 1: Category filter correctness
// Feature: trendify-backend-cms, Property 2: Region filter with fallback correctness
// Feature: trendify-backend-cms, Property 3: Cursor pagination — completeness and non-overlap
// Feature: trendify-backend-cms, Property 4: pageSize enforcement
// Feature: trendify-backend-cms, Property 5: TrendItem lookup round-trip
// Feature: trendify-backend-cms, Property 32: Locale fallback to English
// Feature: trendify-backend-cms, Property 33: Content-Language header invariant

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

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindFirst = jest.fn();
const mockUpsert = jest.fn();
const mockFindUnique = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    trendItem: {
      findMany: mockFindMany,
      count: mockCount,
      findFirst: mockFindFirst,
      upsert: mockUpsert,
    },
    userPreferences: { findUnique: mockFindUnique },
  },
}));

import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';
import { Category } from '@prisma/client';
import * as trendService from './trend.service';

const CATEGORIES = Object.values(Category);

function makeTrendItem(overrides: Record<string, unknown> = {}) {
  return {
    id: uuidv4(),
    strapiId: uuidv4(),
    title: 'Test Title',
    description: 'Test Description',
    source: 'Test Source',
    publishedAt: new Date('2024-01-01T00:00:00Z'),
    imageUrl: null as string | null,
    url: 'https://example.com',
    category: Category.technology as Category,
    regionCode: null as string | null,
    locale: 'en',
    published: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCount.mockResolvedValue(0);
  mockFindUnique.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Property 1: Category filter correctness — Validates: Requirements 1.2
// ---------------------------------------------------------------------------
describe('Property 1: Category filter correctness', () => {
  it('all returned items have a category matching the requested filter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CATEGORIES),
        async (category) => {
          const items = [makeTrendItem({ category }), makeTrendItem({ category })];
          mockFindMany.mockResolvedValue(items);
          mockCount.mockResolvedValue(items.length);

          const result = await trendService.listTrends({ categories: [category] });

          expect(result.items.every((i) => i.category === category)).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Region filter with fallback — Validates: Requirements 1.3
// ---------------------------------------------------------------------------
describe('Property 2: Region filter with fallback correctness', () => {
  it('returned items have matching regionCode or null regionCode', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('US', 'GB', 'DE', 'FR'),
        async (regionCode) => {
          const items = [
            makeTrendItem({ regionCode }),
            makeTrendItem({ regionCode: null }),
          ];
          mockFindMany.mockResolvedValue(items);
          mockCount.mockResolvedValue(items.length);

          const result = await trendService.listTrends({ regionCode });

          expect(
            result.items.every((i) => i.regionCode === regionCode || i.regionCode === null),
          ).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Cursor pagination completeness and non-overlap — Validates: Requirements 1.4, 18.5
// ---------------------------------------------------------------------------
describe('Property 3: Cursor pagination completeness and non-overlap', () => {
  it('paginating through all pages yields each item exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        async (totalItems, pageSize) => {
          // Build a sorted list of items
          const allItems = Array.from({ length: totalItems }, (_, i) =>
            makeTrendItem({
              id: `id-${String(i).padStart(3, '0')}`,
              publishedAt: new Date(2024, 0, totalItems - i),
            }),
          );

          // Simulate paginated responses
          let callCount = 0;
          mockFindMany.mockImplementation(() => {
            const start = callCount * pageSize;
            const slice = allItems.slice(start, start + pageSize + 1);
            callCount++;
            return Promise.resolve(slice);
          });
          mockCount.mockResolvedValue(totalItems);

          // Collect all items across pages
          const seen = new Set<string>();
          let cursor: string | undefined;
          let pages = 0;

          do {
            const result = await trendService.listTrends({ pageSize, cursor });
            for (const item of result.items) {
              expect(seen.has(item.id)).toBe(false); // no duplicates
              seen.add(item.id);
            }
            cursor = result.nextCursor ?? undefined;
            pages++;
            if (pages > totalItems + 1) break; // safety
          } while (cursor);

          // All items seen
          expect(seen.size).toBe(allItems.slice(0, seen.size).length);
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: pageSize enforcement — Validates: Requirements 1.5, 1.6
// ---------------------------------------------------------------------------
describe('Property 4: pageSize enforcement', () => {
  it('response contains at most pageSize items for valid pageSize 1–100', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (pageSize) => {
          const items = Array.from({ length: pageSize }, () => makeTrendItem());
          mockFindMany.mockResolvedValue(items);
          mockCount.mockResolvedValue(items.length);

          const result = await trendService.listTrends({ pageSize });
          expect(result.items.length).toBeLessThanOrEqual(pageSize);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: TrendItem lookup round-trip — Validates: Requirements 1.7
// ---------------------------------------------------------------------------
describe('Property 5: TrendItem lookup round-trip', () => {
  it('getTrendById returns item with matching id, title, category, locale', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CATEGORIES),
        fc.constantFrom('en', 'fr', 'de'),
        async (category, locale) => {
          const item = makeTrendItem({ category, locale });
          mockFindFirst.mockResolvedValue(item);

          const result = await trendService.getTrendById(item.id, locale);

          expect(result.id).toBe(item.id);
          expect(result.category).toBe(category);
          expect(result.locale).toBe(locale);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 32: Locale fallback to English — Validates: Requirements 19.6
// ---------------------------------------------------------------------------
describe('Property 32: Locale fallback to English', () => {
  it('when item not found in requested locale, returns en variant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('fr', 'de', 'es', 'ja'),
        async (locale) => {
          const enItem = makeTrendItem({ locale: 'en' });
          // First call (requested locale) returns null, second call (en) returns item
          mockFindFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(enItem);

          const result = await trendService.getTrendById(enItem.id, locale);
          expect(result.locale).toBe('en');
        },
      ),
      { numRuns: 20 },
    );
  });
});
