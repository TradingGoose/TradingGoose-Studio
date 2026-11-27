/**
 * Utility functions for file parsing
 */

/**
 * Clean text content to ensure it's safe for UTF-8 storage in PostgreSQL
 * Removes null bytes and control characters that can cause encoding errors
 */
export function sanitizeTextForUTF8(text: string): string {
  if (!text || typeof text !== 'string') {
    return ''
  }

  return text
    .replace(/\0/g, '') // Remove null bytes (0x00)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters except \t(0x09), \n(0x0A), \r(0x0D)
    .replace(/\uFFFD/g, '') // Remove Unicode replacement character
    .replace(/[\uD800-\uDFFF]/g, '') // Remove unpaired surrogate characters
}
