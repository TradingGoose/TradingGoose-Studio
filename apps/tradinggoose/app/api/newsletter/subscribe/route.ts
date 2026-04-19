import { type NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { sendEmail } from '@/lib/email/mailer'
import { renderNewsletterWelcomeEmail } from '@/components/emails/render-email'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveResendServiceConfig } from '@/lib/system-services/runtime'

const logger = createLogger('NewsletterAPI')

export async function POST(req: NextRequest) {
  try {
    const resendConfig = await resolveResendServiceConfig()

    if (!resendConfig.apiKey || !resendConfig.audienceId) {
      return NextResponse.json(
        { error: 'Newsletter service not configured' },
        { status: 503 }
      )
    }

    const body = await req.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    const resend = new Resend(resendConfig.apiKey)

    // Create the contact first
    const { data: contactData, error: createError } = await resend.contacts.create({
      audienceId: resendConfig.audienceId,
      email,
    })

    if (createError) {
      logger.error('Failed to create contact', { error: createError })
      return NextResponse.json(
        { error: 'Failed to subscribe' },
        { status: 500 }
      )
    }

    const data = contactData

    // Send welcome email (non-blocking)
    renderNewsletterWelcomeEmail()
      .then((html) =>
        sendEmail({
          to: email,
          subject: 'Welcome to TradingGoose updates',
          html,
          emailType: 'transactional',
          includeUnsubscribe: false,
        })
      )
      .catch((err) => logger.error('Failed to send welcome email', err))

    return NextResponse.json({ success: true, id: data?.id })
  } catch (error) {
    logger.error('Newsletter subscribe error', error)
    return NextResponse.json(
      { error: 'Failed to subscribe' },
      { status: 500 }
    )
  }
}
