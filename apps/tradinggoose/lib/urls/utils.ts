import { getEnv } from '@/lib/env'

export function getBaseUrl(): string {
  const configuredAppUrl = getEnv('NEXT_PUBLIC_APP_URL')?.trim()
  const value =
    configuredAppUrl ||
    (process.env.EMAILS_DIR_ABSOLUTE_PATH || process.env.PREVIEW_SERVER_LOCATION
      ? getEnv('EMAILS_PREVIEW_BASE_URL')?.trim() || 'http://localhost:3000'
      : undefined)

  if (!value) {
    throw new Error('NEXT_PUBLIC_APP_URL is required')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Configured base URL must be a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Configured base URL must use http or https')
  }

  return url.origin
}

export function getBaseDomain(): string {
  return new URL(getBaseUrl()).host
}

export function getEmailDomain(): string {
  return getBaseDomain().replace(/^www\./, '')
}
