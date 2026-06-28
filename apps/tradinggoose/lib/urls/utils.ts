import { getEnv } from '@/lib/env'

type RequestOrigin = Pick<Request, 'url'>

export function getBaseUrl(request?: RequestOrigin): string {
  if (request) {
    return new URL(request.url).origin
  }

  const value = getEnv('NEXT_PUBLIC_APP_URL')?.trim()

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
