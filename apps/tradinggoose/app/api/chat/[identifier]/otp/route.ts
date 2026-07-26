import { db } from '@tradinggoose/db'
import { chat } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { renderOTPEmail } from '@/components/emails/render-email'
import { getEmailSubject } from '@/components/emails/render-email'
import { normalizeEmailLocale } from '@/lib/email/locale'
import { sendEmail } from '@/lib/email/mailer'
import { createLogger } from '@/lib/logs/console/logger'
import { deleteCachedValue, getCachedValue, setCachedValue } from '@/lib/redis'
import { generateRequestId } from '@/lib/utils'
import { CHAT_ERROR_CODES } from '@/app/chat/constants'
import { addCorsHeaders, setChatAuthCookie } from '@/app/api/chat/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import { locales } from '@/i18n/utils'

const logger = createLogger('ChatOtpAPI')

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// OTP storage utility functions using Redis
// We use 15 minutes (900 seconds) expiry for OTPs
const OTP_EXPIRY = 15 * 60

// Store OTP in Redis
async function storeOTP(email: string, chatId: string, otp: string): Promise<void> {
  const key = `otp:${email}:${chatId}`
  await setCachedValue(key, otp, OTP_EXPIRY)
}

// Get OTP from Redis
async function getOTP(email: string, chatId: string): Promise<string | null> {
  const key = `otp:${email}:${chatId}`
  return await getCachedValue(key)
}

// Delete OTP from Redis
async function deleteOTP(email: string, chatId: string): Promise<void> {
  const key = `otp:${email}:${chatId}`
  await deleteCachedValue(key)
}

const otpRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  locale: z.enum(locales).optional(),
})

const otpVerifySchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
})

// Send OTP endpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Processing OTP request for identifier: ${identifier}`)

    // Parse request body
    let body
    try {
      body = await request.json()
      const { email, locale: requestLocale } = otpRequestSchema.parse(body)

      // Find the chat deployment
      const deploymentResult = await db
        .select({
          id: chat.id,
          authType: chat.authType,
          allowedEmails: chat.allowedEmails,
          title: chat.title,
        })
        .from(chat)
        .where(eq(chat.identifier, identifier))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return addCorsHeaders(
          createErrorResponse('Chat not found', 404, CHAT_ERROR_CODES.CHAT_NOT_FOUND),
          request
        )
      }

      const deployment = deploymentResult[0]

      // Verify this is an email-protected chat
      if (deployment.authType !== 'email') {
        return addCorsHeaders(
          createErrorResponse(
            'This chat does not use email authentication',
            400,
            CHAT_ERROR_CODES.CHAT_AUTH_TYPE_NOT_EMAIL
          ),
          request
        )
      }

      const allowedEmails: string[] = Array.isArray(deployment.allowedEmails)
        ? deployment.allowedEmails
        : []

      const isEmailAllowed =
        allowedEmails.includes(email) ||
        allowedEmails.some((allowed: string) => {
          if (allowed.startsWith('@')) {
            const domain = email.split('@')[1]
            return domain && allowed === `@${domain}`
          }
          return false
        })

      if (!isEmailAllowed) {
        return addCorsHeaders(
          createErrorResponse(
            'Email not authorized for this chat',
            403,
            CHAT_ERROR_CODES.EMAIL_NOT_AUTHORIZED
          ),
          request
        )
      }

      const otp = generateOTP()

      await storeOTP(email, deployment.id, otp)
      const locale = normalizeEmailLocale(requestLocale)

      const emailHtml = await renderOTPEmail(
        otp,
        email,
        'chat-access',
        deployment.title || 'Chat',
        locale
      )

      const emailResult = await sendEmail({
        to: email,
        subject: getEmailSubject('chat-access', locale, { chatTitle: deployment.title || 'Chat' }),
        html: emailHtml,
      })

      if (!emailResult.success) {
        logger.error(`[${requestId}] Failed to send OTP email:`, emailResult.message)
        return addCorsHeaders(
          createErrorResponse(
            'Failed to send verification email',
            500,
            CHAT_ERROR_CODES.VERIFICATION_CODE_SEND_FAILED
          ),
          request
        )
      }

      // Add a small delay to ensure Redis has fully processed the operation
      // This helps with eventual consistency in distributed systems
      await new Promise((resolve) => setTimeout(resolve, 500))

      logger.info(`[${requestId}] OTP sent to ${email} for chat ${deployment.id}`)
      return addCorsHeaders(createSuccessResponse({ message: 'Verification code sent' }), request)
      } catch (error: any) {
      if (error instanceof z.ZodError) {
        return addCorsHeaders(
          createErrorResponse(
            error.issues[0]?.message || 'Invalid request',
            400,
            CHAT_ERROR_CODES.INVALID_REQUEST
          ),
          request
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error processing OTP request:`, error)
    return addCorsHeaders(
      createErrorResponse(
        error.message || 'Failed to process request',
        500,
        CHAT_ERROR_CODES.FAILED_TO_PROCESS_REQUEST
      ),
      request
    )
  }
}

// Verify OTP endpoint
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  const { identifier } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Verifying OTP for identifier: ${identifier}`)

    // Parse request body
    let body
    try {
      body = await request.json()
      const { email, otp } = otpVerifySchema.parse(body)

      // Find the chat deployment
      const deploymentResult = await db
        .select({
          id: chat.id,
          authType: chat.authType,
        })
        .from(chat)
        .where(eq(chat.identifier, identifier))
        .limit(1)

      if (deploymentResult.length === 0) {
        logger.warn(`[${requestId}] Chat not found for identifier: ${identifier}`)
        return addCorsHeaders(
          createErrorResponse('Chat not found', 404, CHAT_ERROR_CODES.CHAT_NOT_FOUND),
          request
        )
      }

      const deployment = deploymentResult[0]

      // Check if OTP exists and is valid
      const storedOTP = await getOTP(email, deployment.id)
      if (!storedOTP) {
        return addCorsHeaders(
          createErrorResponse(
            'No verification code found, request a new one',
            400,
            CHAT_ERROR_CODES.VERIFICATION_CODE_MISSING
          ),
          request
        )
      }

      // Check if OTP matches
      if (storedOTP !== otp) {
        return addCorsHeaders(
          createErrorResponse(
            'Invalid verification code',
            400,
            CHAT_ERROR_CODES.VERIFICATION_CODE_INVALID
          ),
          request
        )
      }

      // OTP is valid, clean up
      await deleteOTP(email, deployment.id)

      // Create success response with auth cookie
      const response = addCorsHeaders(createSuccessResponse({ authenticated: true }), request)

      // Set authentication cookie
      setChatAuthCookie(response, deployment.id, deployment.authType)

      return response
      } catch (error: any) {
      if (error instanceof z.ZodError) {
        return addCorsHeaders(
          createErrorResponse(
            error.issues[0]?.message || 'Invalid request',
            400,
            CHAT_ERROR_CODES.INVALID_REQUEST
          ),
          request
        )
      }
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error verifying OTP:`, error)
    return addCorsHeaders(
      createErrorResponse(
        error.message || 'Failed to process request',
        500,
        CHAT_ERROR_CODES.FAILED_TO_PROCESS_REQUEST
      ),
      request
    )
  }
}
