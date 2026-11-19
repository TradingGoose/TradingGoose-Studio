import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getEmailSubject, renderHelpConfirmationEmail } from '@/components/emails/render-email'
import { getSession } from '@/lib/auth'
import { resolveEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { getHelpEmailAddress } from '@/lib/email/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('HelpAPI')

const helpFormSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get user session
    const session = await getSession()
    if (!session?.user?.email) {
      logger.warn(`[${requestId}] Unauthorized help request attempt`)
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const email = session.user.email

    // Handle multipart form data
    const formData = await req.formData()

    const validationResult = helpFormSchema.safeParse({
      subject: formData.get('subject'),
      message: formData.get('message'),
      type: formData.get('type'),
    })

    if (!validationResult.success) {
      logger.warn(`[${requestId}] Invalid help request data`, {
        errors: validationResult.error.format(),
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: validationResult.error.format() },
        { status: 400 }
      )
    }

    const { subject, message, type } = validationResult.data
    logger.info(`[${requestId}] Processing help request`, {
      type,
      email: `${email.substring(0, 3)}***`,
    })

    const images = []
    for (const [key, value] of formData) {
      if (key.startsWith('image_') && typeof value !== 'string') {
        images.push({
          filename: value.name,
          content: Buffer.from(await value.arrayBuffer()).toString('base64'),
          contentType: value.type,
        })
      }
    }

    logger.debug(`[${requestId}] Help request includes ${images.length} images`)
    const helpEmailAddress = await getHelpEmailAddress()

    // Prepare email content
    let emailText = `
Type: ${type}
From: ${email}

${message}
    `

    if (images.length > 0) {
      emailText += `\n\n${images.length} image(s) attached.`
    }

    const emailResult = await sendEmail({
      to: helpEmailAddress,
      subject: `[${type.toUpperCase()}] ${subject}`,
      text: emailText,
      replyTo: email,
      emailType: 'transactional',
      attachments: images,
    })

    if (!emailResult.success) {
      logger.error(`[${requestId}] Error sending help request email`, emailResult.message)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    logger.info(`[${requestId}] Help request email sent successfully`)

    // Send confirmation email to the user
    try {
      const locale = await resolveEmailLocale({ userId: session.user.id, email })
      const confirmationHtml = await renderHelpConfirmationEmail(email, type, images.length, locale)

      await sendEmail({
        to: email,
        subject: getEmailSubject('help-confirmation', locale),
        html: confirmationHtml,
        replyTo: helpEmailAddress,
        emailType: 'transactional',
      })
    } catch (err) {
      logger.warn(`[${requestId}] Failed to send confirmation email`, err)
    }

    return NextResponse.json(
      { success: true, message: 'Help request submitted successfully' },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes('not configured')) {
      logger.error(`[${requestId}] Email service configuration error`, error)
      return NextResponse.json(
        {
          error:
            'Email service configuration error. Please check your email service configuration.',
        },
        { status: 500 }
      )
    }

    logger.error(`[${requestId}] Error processing help request`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
