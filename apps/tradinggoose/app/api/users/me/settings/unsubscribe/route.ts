import { db } from '@tradinggoose/db'
import { user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getEmailRecipient,
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

function invalidLink() {
  return NextResponse.json(
    { error: 'invalid_or_expired_unsubscribe_link', code: 'invalid-link' },
    { status: 400 }
  )
}

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

    const recipient = await getEmailRecipient(eq(user.email, email))
    if (!recipient || !verifyUnsubscribeToken(recipient, token)) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return invalidLink()
    }

    return NextResponse.json({
      success: true,
      email,
      currentPreferences: recipient.preferences ?? {},
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

    const updated = await db.transaction(async (tx) => {
      const recipient = await getEmailRecipient(eq(user.email, email), tx)
      if (!recipient || !verifyUnsubscribeToken(recipient, token)) return false
      await updateEmailPreferences(tx, recipient.id, { [preferenceKeys[type]]: true })
      return true
    })
    if (!updated) {
      logger.warn(`[${requestId}] Invalid unsubscribe token for email: ${email}`)
      return invalidLink()
    }

    logger.info(`[${requestId}] Successfully unsubscribed ${email} from ${type}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error processing unsubscribe POST request:`, error)
    return NextResponse.json(
      { error: 'internal_server_error', code: 'internal-error' },
      { status: 500 }
    )
  }
}
