/**
 * Sanitise a user-supplied string to prevent XSS and SQL injection payloads
 * from being persisted. Strips HTML tags and encodes dangerous characters.
 */
export function sanitizeString(input: string): string {
  return input
    // Remove HTML/script tags
    .replace(/<[^>]*>/g, '')
    // Encode angle brackets
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Encode quotes
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Remove null bytes
    .replace(/\0/g, '')
    .trim();
}

/**
 * Sanitise all string values in a plain object (one level deep).
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      (result as Record<string, unknown>)[key] = sanitizeString(result[key] as string);
    }
  }
  return result;
}
