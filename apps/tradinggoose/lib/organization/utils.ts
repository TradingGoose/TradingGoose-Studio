import { quickValidateEmail } from '@/lib/email/validation'

/**
 * Generate a URL-friendly slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-') // Replace consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading and trailing hyphens
}

/**
 * Validate organization slug format
 */
export function validateSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9-_]+$/
  return slugRegex.test(slug)
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  return quickValidateEmail(email.trim().toLowerCase()).isValid
}
