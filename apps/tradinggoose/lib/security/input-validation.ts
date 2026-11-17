import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('InputValidation')

/**
 * Result type for validation functions
 */
export interface ValidationResult {
  isValid: boolean
  error?: string
  sanitized?: string
}

/**
 * Options for path segment validation
 */
export interface PathSegmentOptions {
  /** Name of the parameter for error messages */
  paramName?: string
  /** Maximum length allowed (default: 255) */
  maxLength?: number
  /** Allow hyphens (default: true) */
  allowHyphens?: boolean
  /** Allow underscores (default: true) */
  allowUnderscores?: boolean
  /** Allow dots (default: false, to prevent directory traversal) */
  allowDots?: boolean
  /** Custom regex pattern to match */
  customPattern?: RegExp
}

/**
 * Validates a path segment to prevent path traversal and SSRF attacks
 *
 * This function ensures that user-provided input used in URL paths or file paths
 * cannot be used for directory traversal attacks or SSRF.
 *
 * Default behavior:
 * - Allows: letters (a-z, A-Z), numbers (0-9), hyphens (-), underscores (_)
 * - Blocks: dots (.), slashes (/, \), null bytes, URL encoding, and special characters
 *
 * @param value - The path segment to validate
 * @param options - Validation options
 * @returns ValidationResult with isValid flag and optional error message
 *
 * @example
 * ```typescript
 * const result = validatePathSegment(itemId, { paramName: 'itemId' })
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validatePathSegment(
  value: string | null | undefined,
  options: PathSegmentOptions = {}
): ValidationResult {
  const {
    paramName = 'path segment',
    maxLength = 255,
    allowHyphens = true,
    allowUnderscores = true,
    allowDots = false,
    customPattern,
  } = options

  // Check for null/undefined
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  // Check length
  if (value.length > maxLength) {
    logger.warn('Path segment exceeds maximum length', {
      paramName,
      length: value.length,
      maxLength,
    })
    return {
      isValid: false,
      error: `${paramName} exceeds maximum length of ${maxLength} characters`,
    }
  }

  // Check for null bytes (potential for bypass attacks)
  if (value.includes('\0') || value.includes('%00')) {
    logger.warn('Path segment contains null bytes', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid characters`,
    }
  }

  // Check for path traversal patterns
  const pathTraversalPatterns = [
    '..',
    './',
    '.\\.', // Windows path traversal
    '%2e%2e', // URL encoded ..
    '%252e%252e', // Double URL encoded ..
    '..%2f',
    '..%5c',
    '%2e%2e%2f',
    '%2e%2e/',
    '..%252f',
  ]

  const lowerValue = value.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerValue.includes(pattern.toLowerCase())) {
      logger.warn('Path traversal attempt detected', {
        paramName,
        pattern,
        value: value.substring(0, 100),
      })
      return {
        isValid: false,
        error: `${paramName} contains invalid path traversal sequences`,
      }
    }
  }

  // Check for directory separators
  if (value.includes('/') || value.includes('\\')) {
    logger.warn('Path segment contains directory separators', { paramName })
    return {
      isValid: false,
      error: `${paramName} cannot contain directory separators`,
    }
  }

  // Use custom pattern if provided
  if (customPattern) {
    if (!customPattern.test(value)) {
      logger.warn('Path segment failed custom pattern validation', {
        paramName,
        pattern: customPattern.toString(),
      })
      return {
        isValid: false,
        error: `${paramName} format is invalid`,
      }
    }
    return { isValid: true, sanitized: value }
  }

  // Build allowed character pattern
  let pattern = '^[a-zA-Z0-9'
  if (allowHyphens) pattern += '\\-'
  if (allowUnderscores) pattern += '_'
  if (allowDots) pattern += '\\.'
  pattern += ']+$'

  const regex = new RegExp(pattern)

  if (!regex.test(value)) {
    logger.warn('Path segment contains disallowed characters', {
      paramName,
      value: value.substring(0, 100),
    })
    return {
      isValid: false,
      error: `${paramName} can only contain alphanumeric characters${allowHyphens ? ', hyphens' : ''}${allowUnderscores ? ', underscores' : ''}${allowDots ? ', dots' : ''}`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates an alphanumeric ID (letters, numbers, hyphens, underscores only)
 *
 * @param value - The ID to validate
 * @param paramName - Name of the parameter for error messages
 * @param maxLength - Maximum length (default: 100)
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateAlphanumericId(userId, 'userId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateAlphanumericId(
  value: string | null | undefined,
  paramName = 'ID',
  maxLength = 100
): ValidationResult {
  return validatePathSegment(value, {
    paramName,
    maxLength,
    allowHyphens: true,
    allowUnderscores: true,
    allowDots: false,
  })
}

/**
 * Validates a numeric ID
 *
 * @param value - The ID to validate
 * @param paramName - Name of the parameter for error messages
 * @param options - Additional options (min, max)
 * @returns ValidationResult with sanitized number as string
 *
 * @example
 * ```typescript
 * const result = validateNumericId(pageNumber, 'pageNumber', { min: 1, max: 1000 })
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateNumericId(
  value: string | number | null | undefined,
  paramName = 'ID',
  options: { min?: number; max?: number } = {}
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  const num = typeof value === 'number' ? value : Number(value)

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    logger.warn('Invalid numeric ID', { paramName, value })
    return {
      isValid: false,
      error: `${paramName} must be a valid number`,
    }
  }

  if (options.min !== undefined && num < options.min) {
    return {
      isValid: false,
      error: `${paramName} must be at least ${options.min}`,
    }
  }

  if (options.max !== undefined && num > options.max) {
    return {
      isValid: false,
      error: `${paramName} must be at most ${options.max}`,
    }
  }

  return { isValid: true, sanitized: num.toString() }
}

/**
 * Validates that a value is in an allowed list (enum validation)
 *
 * @param value - The value to validate
 * @param allowedValues - Array of allowed values
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateEnum(type, ['note', 'contact', 'task'], 'type')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateEnum<T extends string>(
  value: string | null | undefined,
  allowedValues: readonly T[],
  paramName = 'value'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  if (!allowedValues.includes(value as T)) {
    logger.warn('Value not in allowed list', {
      paramName,
      value,
      allowedValues,
    })
    return {
      isValid: false,
      error: `${paramName} must be one of: ${allowedValues.join(', ')}`,
    }
  }

  return { isValid: true, sanitized: value }
}

/**
 * Validates Microsoft Graph API resource IDs
 *
 * Microsoft Graph IDs can be complex - for example, SharePoint site IDs can include:
 * - "root" (literal string)
 * - GUIDs
 * - Hostnames with colons and slashes (e.g., "hostname:/sites/sitename")
 * - Group paths (e.g., "groups/{guid}/sites/root")
 *
 * This function allows these legitimate patterns while blocking path traversal.
 *
 * @param value - The Microsoft Graph ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateMicrosoftGraphId(siteId, 'siteId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateMicrosoftGraphId(
  value: string | null | undefined,
  paramName = 'ID'
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      isValid: false,
      error: `${paramName} is required`,
    }
  }

  // Check for path traversal patterns (../)
  const pathTraversalPatterns = [
    '../',
    '..\\',
    '%2e%2e%2f',
    '%2e%2e/',
    '..%2f',
    '%2e%2e%5c',
    '%2e%2e\\',
    '..%5c',
    '%252e%252e%252f', // double encoded
  ]

  const lowerValue = value.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerValue.includes(pattern)) {
      logger.warn('Path traversal attempt in Microsoft Graph ID', {
        paramName,
        value: value.substring(0, 100),
      })
      return {
        isValid: false,
        error: `${paramName} contains invalid path traversal sequence`,
      }
    }
  }

  // Check for control characters and null bytes
  if (/[\x00-\x1f\x7f]/.test(value) || value.includes('%00')) {
    logger.warn('Control characters in Microsoft Graph ID', { paramName })
    return {
      isValid: false,
      error: `${paramName} contains invalid control characters`,
    }
  }

  // Check for newlines (which could be used for header injection)
  if (value.includes('\n') || value.includes('\r')) {
    return {
      isValid: false,
      error: `${paramName} contains invalid newline characters`,
    }
  }

  // Microsoft Graph IDs can contain many characters, but not suspicious patterns
  // We've blocked path traversal, so allow the rest
  return { isValid: true, sanitized: value }
}

/**
 * Validates Jira Cloud IDs (typically UUID format)
 *
 * @param value - The Jira Cloud ID to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateJiraCloudId(cloudId, 'cloudId')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateJiraCloudId(
  value: string | null | undefined,
  paramName = 'cloudId'
): ValidationResult {
  // Jira cloud IDs are alphanumeric with hyphens (UUID-like)
  return validatePathSegment(value, {
    paramName,
    allowHyphens: true,
    allowUnderscores: false,
    allowDots: false,
    maxLength: 100,
  })
}

/**
 * Validates Jira issue keys (format: PROJECT-123 or PROJECT-KEY-123)
 *
 * @param value - The Jira issue key to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateJiraIssueKey(issueKey, 'issueKey')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateJiraIssueKey(
  value: string | null | undefined,
  paramName = 'issueKey'
): ValidationResult {
  // Jira issue keys: letters, numbers, hyphens (PROJECT-123 format)
  return validatePathSegment(value, {
    paramName,
    allowHyphens: true,
    allowUnderscores: false,
    allowDots: false,
    maxLength: 255,
  })
}

/**
 * Validates a URL to prevent SSRF attacks
 *
 * This function checks that URLs:
 * - Use https:// protocol only
 * - Do not point to private IP ranges or localhost
 * - Do not use suspicious ports
 *
 * @param url - The URL to validate
 * @param paramName - Name of the parameter for error messages
 * @returns ValidationResult
 *
 * @example
 * ```typescript
 * const result = validateExternalUrl(url, 'fileUrl')
 * if (!result.isValid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * ```
 */
export function validateExternalUrl(
  url: string | null | undefined,
  paramName = 'url'
): ValidationResult {
  if (!url || typeof url !== 'string') {
    return {
      isValid: false,
      error: `${paramName} is required and must be a string`,
    }
  }

  // Must be a valid URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      isValid: false,
      error: `${paramName} must be a valid URL`,
    }
  }

  // Only allow https protocol
  if (parsedUrl.protocol !== 'https:') {
    return {
      isValid: false,
      error: `${paramName} must use https:// protocol`,
    }
  }

  // Block private IP ranges and localhost
  const hostname = parsedUrl.hostname.toLowerCase()

  // Block localhost variations
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname === '0.0.0.0'
  ) {
    return {
      isValid: false,
      error: `${paramName} cannot point to localhost`,
    }
  }

  // Block private IP ranges
  const privateIpPatterns = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./, // Link-local
    /^fe80:/i, // IPv6 link-local
    /^fc00:/i, // IPv6 unique local
    /^fd00:/i, // IPv6 unique local
  ]

  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      return {
        isValid: false,
        error: `${paramName} cannot point to private IP addresses`,
      }
    }
  }

  // Block suspicious ports commonly used for internal services
  const port = parsedUrl.port
  const blockedPorts = [
    '22', // SSH
    '23', // Telnet
    '25', // SMTP
    '3306', // MySQL
    '5432', // PostgreSQL
    '6379', // Redis
    '27017', // MongoDB
    '9200', // Elasticsearch
  ]

  if (port && blockedPorts.includes(port)) {
    return {
      isValid: false,
      error: `${paramName} uses a blocked port`,
    }
  }

  return { isValid: true }
}
