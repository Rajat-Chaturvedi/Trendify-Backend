import { Request } from 'express';

const BCP47_RE = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;

/** Validate a BCP 47 language tag (simplified but covers common cases). */
export function isValidBcp47(tag: string): boolean {
  return BCP47_RE.test(tag);
}

/** Error messages keyed by locale then error key. Falls back to 'en'. */
const messages: Record<string, Record<string, string>> = {
  en: {
    'validation.error': 'Validation error',
    'internal.error': 'Internal server error',
    'not.found': 'Resource not found',
    'unauthorized': 'Authentication required',
  },
};

/** Format an error message in the given locale, falling back to 'en'. */
export function formatError(key: string, locale: string): string {
  const lang = locale.split('-')[0].toLowerCase();
  return (
    messages[lang]?.[key] ??
    messages[locale]?.[key] ??
    messages['en'][key] ??
    key
  );
}

/**
 * Resolve the content locale for a request using priority:
 * 1. `locale` query param (if valid BCP 47)
 * 2. `Accept-Language` header (first tag)
 * 3. Authenticated user's stored locale preference
 * 4. Fallback: "en"
 */
export function resolveLocale(req: Request & { userLocale?: string }): string {
  // 1. Explicit query param
  const queryLocale = req.query?.locale as string | undefined;
  if (queryLocale && isValidBcp47(queryLocale)) return queryLocale;

  // 2. Accept-Language header — take the first tag
  const acceptLang = req.headers['accept-language'];
  if (acceptLang) {
    const first = acceptLang.split(',')[0].trim().split(';')[0].trim();
    if (first && isValidBcp47(first)) return first;
  }

  // 3. User preference (attached by auth middleware or passed explicitly)
  if (req.userLocale && isValidBcp47(req.userLocale)) return req.userLocale;

  return 'en';
}
