import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getEmailPreferences,
  updateEmailPreferences,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('UnsubscribeAPI')
const preferenceKeys = {
  all: 'unsubscribeAll',
  marketing: 'unsubscribeMarketing',
  updates: 'unsubscribeUpdates',
  notifications: 'unsubscribeNotifications',
} as const

const unsubscribeSchema = z.object({
  email: z.string().email('Invalid email address'),
  token: z.string().min(1, 'Token is required'),
  type: z.enum(['all', 'marketing', 'updates', 'notifications']).optional().default('all'),
})

export async function GET(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(req.url)
    const email = searchParams.get('email')
    const token = searchParams.get('token')

    if (!email || !token) {
      logger.warn(`[${requestId}] Missing email or token in GET request`)
      return NextResponse.json(
        { error: 'missing_email_or_token', code: 'missing-parameters' },
        { status: 400 }
      )
    }

    // Verify token and get email type
    const tokenVerification = verifyUnsubscribeToken(email, token)
    if (!tokenVerification.valid) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return NextResponse.json(
        { error: 'invalid_or_expired_unsubscribe_link', code: 'invalid-link' },
        { status: 400 }
      )
    }

    const { emailType } = tokenVerification

    // Get current preferences
    const preferences = await getEmailPreferences(email)

    logger.info(
      `[${requestId}] Valid unsubscribe GET request for email: ${email}, type: ${emailType}`
    )

    return NextResponse.json({
      success: true,
      email,
      token,
      emailType,
      isTransactional: emailType === 'transactional',
      currentPreferences: preferences || {},
    })
  } catch (error) {
    logger.error(`[${requestId}] Error processing unsubscribe GET request:`, error)
    return NextResponse.json(
      { error: 'internal_server_error', code: 'internal-error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await req.json()
    const result = unsubscribeSchema.safeParse(body)

    if (!result.success) {
      logger.warn(`[${requestId}] Invalid unsubscribe POST data`, {
        errors: result.error.format(),
      })
      return NextResponse.json(
        {
          error: 'invalid_request_data',
          code: 'invalid-request-data',
          details: result.error.format(),
        },
        { status: 400 }
      )
    }

    const { email, token, type } = result.data

    // Verify token and get email type
    const tokenVerification = verifyUnsubscribeToken(email, token)
    if (!tokenVerification.valid) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return NextResponse.json(
        { error: 'invalid_or_expired_unsubscribe_link', code: 'invalid-link' },
        { status: 400 }
      )
    }

    const { emailType } = tokenVerification

    // Prevent unsubscribing from transactional emails
    if (emailType === 'transactional') {
      logger.warn(`[${requestId}] Attempted to unsubscribe from transactional email: ${email}`)
      return NextResponse.json(
        {
          error: 'cannot_unsubscribe_from_transactional_emails',
          code: 'transactional',
          isTransactional: true,
          message: 'transactional_emails_unsubscribable',
        },
        { status: 400 }
      )
    }

    const success = await updateEmailPreferences(email, { [preferenceKeys[type]]: true })

    if (!success) {
      logger.error(`[${requestId}] Failed to update unsubscribe preferences for: ${email}`)
      return NextResponse.json(
        { error: 'failed_to_process_unsubscribe_request', code: 'failed-processing' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Successfully unsubscribed ${email} from ${type}`)

    // Return 200 for one-click unsubscribe compliance
    return NextResponse.json(
      {
        success: true,
        code: 'success',
        message: `Successfully unsubscribed from ${type} emails`,
        email,
        type,
        emailType,
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error processing unsubscribe POST request:`, error)
    return NextResponse.json(
      { error: 'internal_server_error', code: 'internal-error' },
      { status: 500 }
    )
  }
}
