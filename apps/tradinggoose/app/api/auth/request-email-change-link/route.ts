import { z } from 'zod'
import { getEmailSubject, renderEmailChangeLinkEmail } from '@/components/emails/render-email'
import { checkFixedUserRateLimit } from '@/lib/api/rate-limit'
import { auth } from '@/lib/auth'
import { hasTrustedFormOrigin } from '@/lib/auth/trusted-form-origin'
import { resolveEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { needsSignupEmailVerification } from '@/lib/environment'
import { localizeSiteUrl } from '@/i18n/utils'

const requestBody = z.strictObject({ accountId: z.string().min(1) })

export async function POST(request: Request) {
  if (!hasTrustedFormOrigin(request)) return new Response(null, { status: 403 })

  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (!session) return new Response(null, { status: 401 })

  const body = requestBody.safeParse(await request.json().catch(() => null))
  if (!body.success) return new Response(null, { status: 400 })
  if (body.data.accountId !== session.user.id) return new Response(null, { status: 403 })
  if (needsSignupEmailVerification(session.user)) {
    return Response.json({ code: 'EMAIL_NOT_VERIFIED', email: session.user.email }, { status: 412 })
  }

  const limit = await checkFixedUserRateLimit(session.user.id, 'email-change-link', 3)
  if (!limit.allowed) {
    return new Response(null, { status: limit.failureKind === 'dependency' ? 503 : 429 })
  }

  const { id: accountId, email } = session.user
  const locale = await resolveEmailLocale({ userId: accountId, email })
  const otp = await auth.api.createVerificationOTP({ body: { email, type: 'email-verification' } })
  const link = new URL(localizeSiteUrl(locale, '/reset-email'))
  link.hash = new URLSearchParams({ accountId, otp }).toString()
  const subject = getEmailSubject('email-change-link', locale)
  const result = await sendEmail({
    to: email,
    subject,
    html: await renderEmailChangeLinkEmail(link.href, locale),
    text: `${subject}\n\n${link.href}`,
    logTextWhenUnconfigured: false,
    emailType: 'transactional',
  })
  return new Response(null, { status: result.success ? 204 : 500 })
}
