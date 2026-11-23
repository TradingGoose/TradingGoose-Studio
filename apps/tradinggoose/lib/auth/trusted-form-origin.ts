import { getBaseUrl } from '@/lib/urls/utils'

export function hasTrustedFormOrigin(request: Request) {
  const trustedOrigin = new URL(getBaseUrl()).origin
  const submittedOrigin = request.headers.get('origin') || request.headers.get('referer')
  if (!submittedOrigin) return false

  try {
    return new URL(submittedOrigin).origin === trustedOrigin
  } catch {
    return false
  }
}
