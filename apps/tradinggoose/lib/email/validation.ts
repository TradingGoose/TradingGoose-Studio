export type EmailValidationResult = { isValid: true } | { isValid: false; reason: string }

// Common disposable email domains (subset - can be expanded)
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'tempmail.org',
  'guerrillamail.com',
  'mailinator.com',
  'yopmail.com',
  'temp-mail.org',
  'throwaway.email',
  'getnada.com',
  '10minutemail.net',
  'temporary-mail.net',
  'fakemailgenerator.com',
  'sharklasers.com',
  'guerrillamailblock.com',
  'pokemail.net',
  'spam4.me',
  'tempail.com',
  'tempr.email',
  'dispostable.com',
  'emailondeck.com',
])

/**
 * Validates email syntax using RFC 5322 compliant regex
 */
function validateEmailSyntax(email: string): boolean {
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return emailRegex.test(email) && email.length <= 254
}

/**
 * Checks for obvious patterns that indicate invalid emails
 */
function hasInvalidPatterns(email: string): boolean {
  // Check for consecutive dots (RFC violation)
  if (email.includes('..')) return true

  // Check for local part length (RFC limit is 64 characters)
  const localPart = email.split('@')[0]
  if (localPart.length > 64) return true

  return false
}

/**
 * Validates email syntax, domain format, and disposable addresses without network requests.
 */
export function quickValidateEmail(email: string): EmailValidationResult {
  if (!validateEmailSyntax(email)) {
    return {
      isValid: false,
      reason: 'Invalid email format',
    }
  }

  const domain = email.split('@')[1].toLowerCase()
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      isValid: false,
      reason: 'Disposable email addresses are not allowed',
    }
  }

  if (hasInvalidPatterns(email)) {
    return {
      isValid: false,
      reason: 'Email contains suspicious patterns',
    }
  }

  if (!domain.includes('.')) {
    return {
      isValid: false,
      reason: 'Invalid domain format',
    }
  }

  return {
    isValid: true,
  }
}
