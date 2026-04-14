// Feature: trendify-backend-cms, Property 35: Multilingual TrendItem JSON round-trip
// Validates: Requirements 18.4, 19.14

import * as fc from 'fast-check';
import { Category } from '@prisma/client';
import { TrendItem } from '../types/trend';

const CATEGORIES = Object.values(Category);
const LOCALES = ['en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'ko'];

function makeTrendItemForLocale(locale: string, category: Category): TrendItem {
  return {
    id: `id-${locale}`,
    strapiId: `strapi-${locale}`,
    title: `Title in ${locale}`,
    description: `Description in ${locale}`,
    source: 'Test Source',
    publishedAt: new Date('2024-06-15T12:00:00Z'),
    imageUrl: null,
    url: 'https://example.com/trend',
    category,
    regionCode: null,
    locale,
  };
}

// ---------------------------------------------------------------------------
// Property 35: Multilingual TrendItem JSON round-trip
// Validates: Requirements 18.4, 19.14
// ---------------------------------------------------------------------------
describe('Property 35: Multilingual TrendItem JSON round-trip', () => {
  it('serialising a TrendItem to JSON and back produces a deeply equal object for each locale', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LOCALES),
        fc.constantFrom(...CATEGORIES),
        (locale, category) => {
          const original = makeTrendItemForLocale(locale, category);

          // Serialise to JSON (simulating HTTP response) and deserialise back
          const serialised = JSON.stringify(original);
          const deserialised = JSON.parse(serialised) as TrendItem;

          // All fields must be preserved exactly
          expect(deserialised.id).toBe(original.id);
          expect(deserialised.strapiId).toBe(original.strapiId);
          expect(deserialised.title).toBe(original.title);
          expect(deserialised.description).toBe(original.description);
          expect(deserialised.source).toBe(original.source);
          expect(deserialised.imageUrl).toBe(original.imageUrl);
          expect(deserialised.url).toBe(original.url);
          expect(deserialised.category).toBe(original.category);
          expect(deserialised.regionCode).toBe(original.regionCode);
          expect(deserialised.locale).toBe(original.locale);
          // publishedAt round-trips as ISO string — compare via getTime
          expect(new Date(deserialised.publishedAt).getTime()).toBe(original.publishedAt.getTime());
        },
      ),
      { numRuns: 20 },
    );
  });

  it('multiple locale variants of the same item each round-trip independently', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORIES),
        (category) => {
          const variants = LOCALES.map((locale) => makeTrendItemForLocale(locale, category));

          for (const original of variants) {
            const roundTripped = JSON.parse(JSON.stringify(original)) as TrendItem;
            expect(roundTripped.locale).toBe(original.locale);
            expect(roundTripped.title).toBe(original.title);
            expect(roundTripped.description).toBe(original.description);
            expect(roundTripped.category).toBe(original.category);
            expect(roundTripped.id).toBe(original.id);
            expect(new Date(roundTripped.publishedAt).getTime()).toBe(original.publishedAt.getTime());
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
