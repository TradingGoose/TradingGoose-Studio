import { getEnv } from '@/lib/env'

/**
 * Returns the configured application URL.
 */
export function getBaseUrl(): string {
  return getConfiguredAppUrl()
}

/**
 * Returns just the domain and port from NEXT_PUBLIC_APP_URL.
 */
export function getBaseDomain(): string {
  return new URL(getConfiguredAppUrl()).host
}

/**
 * Returns the domain for email addresses, stripping www subdomain for Resend compatibility
 * @returns The email domain (e.g., 'tradinggoose.ai' instead of 'www.tradinggoose.ai')
 */
export function getEmailDomain(): string {
  const baseDomain = getBaseDomain()
  return baseDomain.startsWith('www.') ? baseDomain.substring(4) : baseDomain
}

function getConfiguredAppUrl() {
  return normalizeHttpOrigin(getEnv('NEXT_PUBLIC_APP_URL'), 'NEXT_PUBLIC_APP_URL')
}

function normalizeHttpOrigin(value: string | undefined, envName: string) {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${envName} is required`)
  }

  let parsed: URL

  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${envName} must be a valid URL`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${envName} must use http or https`)
  }

  return parsed.origin
}
