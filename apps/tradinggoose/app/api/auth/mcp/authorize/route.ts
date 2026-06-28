import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { approveMcpDeviceLogin, cancelMcpDeviceLogin } from '@/lib/mcp/auth'
import { getBaseUrl } from '@/lib/urls/utils'
import { normalizeLocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

function redirectToAuthorizeStatus(request: NextRequest, locale: string, status: string) {
  const url = new URL(`/${normalizeLocaleCode(locale)}/mcp/authorize`, getBaseUrl(request))
  url.searchParams.set('status', status)
  return NextResponse.redirect(url)
}

function redirectToLogin(request: NextRequest, locale: string, code: string) {
  const normalizedLocale = normalizeLocaleCode(locale)
  const url = new URL(`/${normalizedLocale}/login`, getBaseUrl(request))
  if (getSessionCookie(request.headers)) {
    url.searchParams.set('reauth', '1')
  }
  url.searchParams.set(
    'callbackUrl',
    `/${normalizedLocale}/mcp/authorize?code=${encodeURIComponent(code)}`
  )
  return NextResponse.redirect(url)
}

function hasTrustedFormOrigin(request: NextRequest) {
  const trustedOrigin = new URL(getBaseUrl(request)).origin
  const submittedOrigin = request.headers.get('origin')
  if (submittedOrigin) {
    try {
      return new URL(submittedOrigin).origin === trustedOrigin
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (!referer) {
    return false
  }

  try {
    return new URL(referer).origin === trustedOrigin
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null)
  const action = formData?.get('action')
  const code = formData?.get('code')
  const approvalToken = formData?.get('approvalToken')
  const localeValue = formData?.get('locale')
  const locale = normalizeLocaleCode(typeof localeValue === 'string' ? localeValue : undefined)

  if (
    (action !== 'approve' && action !== 'cancel') ||
    typeof code !== 'string' ||
    !code ||
    typeof approvalToken !== 'string' ||
    !approvalToken ||
    !hasTrustedFormOrigin(request)
  ) {
    return redirectToAuthorizeStatus(request, locale, 'invalid')
  }

  const session = await getSession(request.headers)
  if (!session?.user?.id) {
    return redirectToLogin(request, locale, code)
  }

  const result =
    action === 'approve'
      ? await approveMcpDeviceLogin({ approvalToken, code, userId: session.user.id })
      : await cancelMcpDeviceLogin({ approvalToken, code, userId: session.user.id })

  return redirectToAuthorizeStatus(request, locale, result.status)
}
