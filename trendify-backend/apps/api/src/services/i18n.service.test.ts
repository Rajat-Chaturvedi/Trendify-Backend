// Feature: trendify-backend-cms, Property 31: Locale resolution priority
// Feature: trendify-backend-cms, Property 34: BCP 47 locale validation

import * as fc from 'fast-check';
import { resolveLocale, isValidBcp47 } from './i18n.service';
import { Request } from 'express';

function makeReq(opts: {
  queryLocale?: string;
  acceptLanguage?: string;
  userLocale?: string;
}): Request {
  return {
    query: opts.queryLocale !== undefined ? { locale: opts.queryLocale } : {},
    headers: opts.acceptLanguage ? { 'accept-language': opts.acceptLanguage } : {},
    userLocale: opts.userLocale,
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Property 31: Locale resolution priority
// Validates: Requirements 19.3, 19.4, 19.5
// ---------------------------------------------------------------------------
describe('Property 31: Locale resolution priority', () => {
  it('locale query param takes precedence over Accept-Language and user prefs', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('fr', 'de', 'es', 'ja', 'zh'),
        fc.constantFrom('en', 'pt', 'ko'),
        fc.constantFrom('it', 'ru', 'nl'),
        (queryLocale, acceptLocale, userLocale) => {
          const req = makeReq({ queryLocale, acceptLanguage: acceptLocale, userLocale });
          expect(resolveLocale(req)).toBe(queryLocale);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('Accept-Language takes precedence over user prefs when no query param', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('fr', 'de', 'es', 'ja'),
        fc.constantFrom('it', 'ru', 'nl'),
        (acceptLocale, userLocale) => {
          const req = makeReq({ acceptLanguage: acceptLocale, userLocale });
          expect(resolveLocale(req)).toBe(acceptLocale);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('user prefs locale used when no query param and no Accept-Language', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('fr', 'de', 'es', 'ja', 'zh'),
        (userLocale) => {
          const req = makeReq({ userLocale });
          expect(resolveLocale(req)).toBe(userLocale);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('falls back to "en" when no locale signals present', () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        const req = makeReq({});
        expect(resolveLocale(req)).toBe('en');
      }),
      { numRuns: 20 },
    );
  });

  it('request with both locale param and Accept-Language uses locale param', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('fr', 'de', 'es'),
        fc.constantFrom('en', 'pt'),
        (queryLocale, acceptLocale) => {
          const req = makeReq({ queryLocale, acceptLanguage: acceptLocale });
          expect(resolveLocale(req)).toBe(queryLocale);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 34: BCP 47 locale validation
// Validates: Requirements 19.10, 19.11
// ---------------------------------------------------------------------------
describe('Property 34: BCP 47 locale validation', () => {
  const validTags = ['en', 'fr', 'de', 'zh', 'ja', 'en-US', 'zh-CN', 'pt-BR', 'fr-CA'];
  const invalidTags = ['', '123', '!!', 'en_US', 'toolongtagthatexceedslimits12345678'];

  it('well-formed BCP 47 tags are accepted', () => {
    fc.assert(
      fc.property(fc.constantFrom(...validTags), (tag) => {
        expect(isValidBcp47(tag)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('malformed tags are rejected', () => {
    fc.assert(
      fc.property(fc.constantFrom(...invalidTags), (tag) => {
        expect(isValidBcp47(tag)).toBe(false);
      }),
      { numRuns: 20 },
    );
  });
});
