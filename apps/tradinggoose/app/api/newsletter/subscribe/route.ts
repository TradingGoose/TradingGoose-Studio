import { type NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { env } from '@/lib/env'
import { sendEmail } from '@/lib/email/mailer'
import { renderNewsletterWelcomeEmail } from '@/components/emails/render-email'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('NewsletterAPI')

export async function POST(req: NextRequest) {
  try {
    if (!env.RESEND_API_KEY || !env.RESEND_SEGMENT_ID) {
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

    const resend = new Resend(env.RESEND_API_KEY)

    // Create the contact first
    const { data: contactData, error: createError } = await resend.contacts.create({
      email,
      segments: [{ id: env.RESEND_SEGMENT_ID }],
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
