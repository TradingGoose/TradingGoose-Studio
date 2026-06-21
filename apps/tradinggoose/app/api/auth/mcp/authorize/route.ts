import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { approveMcpDeviceLogin, cancelMcpDeviceLogin } from '@/lib/mcp/auth'
import { normalizeLocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

function redirectToAuthorizeStatus(request: NextRequest, locale: string, status: string) {
  const url = new URL(`/${normalizeLocaleCode(locale)}/mcp/authorize`, request.nextUrl.origin)
  url.searchParams.set('status', status)
  return NextResponse.redirect(url)
}

function redirectToLogin(request: NextRequest, locale: string, code: string) {
  const url = new URL(`/${normalizeLocaleCode(locale)}/login`, request.nextUrl.origin)
  if (getSessionCookie(request.headers)) {
    url.searchParams.set('reauth', '1')
  }
  url.searchParams.set('callbackUrl', `/mcp/authorize?code=${encodeURIComponent(code)}`)
  return NextResponse.redirect(url)
}

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null)
  const action = formData?.get('action')
  const approvalToken = formData?.get('approvalToken')
  const code = formData?.get('code')
  const localeValue = formData?.get('locale')
  const locale = normalizeLocaleCode(typeof localeValue === 'string' ? localeValue : undefined)

  if (
    (action !== 'approve' && action !== 'cancel') ||
    typeof approvalToken !== 'string' ||
    !approvalToken ||
    typeof code !== 'string' ||
    !code
  ) {
    return redirectToAuthorizeStatus(request, locale, 'invalid')
  }

  const session = await getSession(request.headers)
  if (!session?.user?.id) {
    return redirectToLogin(request, locale, code)
  }

  const result =
    action === 'approve'
      ? await approveMcpDeviceLogin({ code, approvalToken, userId: session.user.id })
      : await cancelMcpDeviceLogin({ code, approvalToken, userId: session.user.id })

  return redirectToAuthorizeStatus(request, locale, result.status)
}
