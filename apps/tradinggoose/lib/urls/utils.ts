import { getEnv } from '@/lib/env'

export function getBaseUrl(): string {
  const value = getEnv('NEXT_PUBLIC_APP_URL')?.trim()
  if (!value) {
    throw new Error('NEXT_PUBLIC_APP_URL is required')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('NEXT_PUBLIC_APP_URL must be a valid URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL must use http or https')
  }

  return url.origin
}

export function getBaseDomain(): string {
  return new URL(getBaseUrl()).host
}

export function getEmailDomain(): string {
  return getBaseDomain().replace(/^www\./, '')
}
