import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { type ErrorResponse, Resend, type Response as ResendResponse } from 'resend'
import type { EmailLocale } from '@/components/emails/email-copy'
import { generateUnsubscribeToken, isUnsubscribed } from '@/lib/email/unsubscribe'
import { getFromEmailAddress } from '@/lib/email/utils'
import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveAzureCommunicationEmailServiceConfig,
  resolveResendServiceConfig,
} from '@/lib/system-services/runtime'
import { getBaseUrl } from '@/lib/urls/utils'
import { localizeUrl } from '@/i18n/utils'

const logger = createLogger('Mailer')

export type EmailType = 'transactional' | 'marketing' | 'updates' | 'notifications'

interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType: string
  disposition?: 'attachment' | 'inline'
}

interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  emailType: EmailType
  attachments?: EmailAttachment[]
  replyTo?: string
  locale?: EmailLocale
}

export type TransactionalBatchEmail = Pick<
  EmailOptions,
  'from' | 'to' | 'subject' | 'html' | 'text'
> & {
  emailType: 'transactional'
}

interface SendEmailResult {
  success: boolean
  message: string
}

interface ProcessedEmailData {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  senderEmail: string
  headers: Record<string, string>
  attachments?: EmailAttachment[]
  replyTo?: string
}

interface EmailClients {
  resend: Resend | null
  azureEmailClient: EmailClient | null
}

type VerifiedUserEmail = {
  id?: string | null
  email?: string | null
}

class ResendContactError extends Error {
  constructor(
    readonly details: ErrorResponse,
    readonly retryAfter?: string
  ) {
    super(details.message)
  }
}

async function readContactResult<T>(response: Promise<ResendResponse<T>>, allowedStatus?: number) {
  const { data, error, headers } = await response
  if (error && (allowedStatus === undefined || error.statusCode !== allowedStatus)) {
    throw new ResendContactError(error, headers?.['retry-after'])
  }
  return data
}

/**
 * Check if any email service is configured and available
 */
export async function hasEmailService(): Promise<boolean> {
  const clients = await resolveEmailClients()
  return Boolean(clients.resend || clients.azureEmailClient)
}

export async function addVerifiedUserEmailToAudience(
  user: VerifiedUserEmail,
  previousEmail?: string
): Promise<void> {
  const email = user.email?.trim().toLowerCase()
  if (!email) return

  try {
    const { apiKey, audienceId: segmentId } = await resolveResendServiceConfig()
    if (!apiKey || !segmentId) return

    const { contacts } = new Resend(apiKey)
    const oldEmail = previousEmail?.trim().toLowerCase()
    for (let attempt = 0; ; attempt++) {
      try {
        const previous =
          oldEmail && oldEmail !== email
            ? await readContactResult(contacts.get({ email: oldEmail }), 404)
            : null
        const unsubscribed = previous?.unsubscribed || (await isUnsubscribed(email, 'marketing'))
        const current = await readContactResult(contacts.get({ email }), 404)

        if (current) {
          if (unsubscribed && !current.unsubscribed) {
            await readContactResult(contacts.update({ id: current.id, unsubscribed: true }))
          }
          await readContactResult(contacts.segments.add({ contactId: current.id, segmentId }), 409)
        } else {
          await readContactResult(
            contacts.create({ email, unsubscribed, segments: [{ id: segmentId }] })
          )
        }

        if (previous) {
          await readContactResult(
            contacts.segments.remove({ contactId: previous.id, segmentId }),
            404
          )
        }
        return
      } catch (error) {
        if (!(error instanceof ResendContactError) || attempt === 2) throw error
        const { statusCode, name } = error.details
        const retryable =
          statusCode === null
            ? name === 'application_error'
            : statusCode === 409 || statusCode === 429 || statusCode >= 500
        if (!retryable) throw error

        const minimumDelay = Number(error.retryAfter) * 1000
        const delay = Math.max(
          1000 * 2 ** attempt,
          Number.isFinite(minimumDelay) ? minimumDelay : 0
        )
        if (delay > 2000) throw error
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  } catch (error) {
    logger.warn('Failed to synchronize verified user email with Resend', {
      userId: user.id,
      error,
    })
  }
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    const clients = await resolveEmailClients()

    // Check if user has unsubscribed (skip for critical transactional emails)
    if (options.emailType !== 'transactional') {
      // For arrays, check the first email address (batch emails typically go to similar recipients)
      const primaryEmail = Array.isArray(options.to) ? options.to[0] : options.to
      const hasUnsubscribed = await isUnsubscribed(primaryEmail, options.emailType)
      if (hasUnsubscribed) {
        logger.info('Email not sent (user unsubscribed):', {
          to: options.to,
          subject: options.subject,
          emailType: options.emailType,
        })
        return {
          success: true,
          message: 'Email skipped (user unsubscribed)',
        }
      }
    }

    // Process email data with unsubscribe tokens and headers
    const processedData = await processEmailData(options)

    // Try Resend first if configured
    if (clients.resend) {
      try {
        return await sendWithResend(clients.resend, processedData)
      } catch (error) {
        if (!clients.azureEmailClient) throw error
        logger.warn('Resend failed, attempting Azure Communication Services fallback:', error)
      }
    }

    // Fallback to Azure Communication Services if configured
    if (clients.azureEmailClient) {
      try {
        return await sendWithAzure(clients.azureEmailClient, processedData)
      } catch (error) {
        logger.error('Azure Communication Services also failed:', error)
        return {
          success: false,
          message: 'Both Resend and Azure Communication Services failed',
        }
      }
    }

    // No email service configured
    logger.info('Email not sent (no email service configured):', {
      to: options.to,
      subject: options.subject,
      from: processedData.senderEmail,
      text: processedData.text,
    })
    return {
      success: true,
      message: 'Email logging successful (no email service configured)',
    }
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
}

async function processEmailData(options: EmailOptions): Promise<ProcessedEmailData> {
  const { to, subject, html, text, from, emailType, attachments, replyTo, locale } = options

  const senderEmail = from || (await getFromEmailAddress())

  // Generate unsubscribe token and add to content
  let finalHtml = html
  let finalText = text
  const headers: Record<string, string> = {}

  if (emailType !== 'transactional') {
    // For arrays, use the first email for unsubscribe (batch emails typically go to similar recipients)
    const primaryEmail = Array.isArray(to) ? to[0] : to
    const unsubscribeToken = generateUnsubscribeToken(primaryEmail, emailType)
    const baseUrl = getBaseUrl()
    const unsubscribeUrl = `${localizeUrl(baseUrl, locale, '/unsubscribe')}?token=${unsubscribeToken}&email=${encodeURIComponent(primaryEmail)}`

    headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'

    if (html) {
      finalHtml = html.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
    }
    if (text) {
      finalText = text.replace(/\{\{UNSUBSCRIBE_TOKEN\}\}/g, unsubscribeToken)
    }
  }

  return {
    to,
    subject,
    html: finalHtml,
    text: finalText,
    senderEmail,
    headers,
    attachments,
    replyTo,
  }
}

async function sendWithResend(resend: Resend, data: ProcessedEmailData): Promise<SendEmailResult> {
  const fromAddress = data.senderEmail

  const emailData: any = {
    from: fromAddress,
    to: data.to,
    subject: data.subject,
    headers: Object.keys(data.headers).length > 0 ? data.headers : undefined,
  }

  if (data.html) emailData.html = data.html
  if (data.text) emailData.text = data.text
  if (data.replyTo) emailData.replyTo = data.replyTo
  if (data.attachments) {
    emailData.attachments = data.attachments.map((att) => ({
      filename: att.filename,
      content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
      contentType: att.contentType,
      disposition: att.disposition || 'attachment',
    }))
  }

  const { error } = await resend.emails.send(emailData)

  if (error) {
    throw new Error(error.message || 'Failed to send email via Resend')
  }

  return {
    success: true,
    message: 'Email sent successfully via Resend',
  }
}

async function sendWithAzure(
  azureEmailClient: EmailClient,
  data: ProcessedEmailData
): Promise<SendEmailResult> {
  // Azure Communication Services requires at least one content type
  if (!data.html && !data.text) {
    throw new Error('Azure Communication Services requires either HTML or text content')
  }

  // For Azure, use just the email address part (no display name)
  // Azure will use the display name configured in the portal for the sender address
  const senderEmailOnly = data.senderEmail.includes('<')
    ? data.senderEmail.match(/<(.+)>/)?.[1] || data.senderEmail
    : data.senderEmail

  const message: EmailMessage = {
    senderAddress: senderEmailOnly,
    content: data.html
      ? {
          subject: data.subject,
          html: data.html,
        }
      : {
          subject: data.subject,
          plainText: data.text!,
        },
    recipients: {
      to: Array.isArray(data.to)
        ? data.to.map((email) => ({ address: email }))
        : [{ address: data.to }],
    },
    headers: data.headers,
  }

  const poller = await azureEmailClient.beginSend(message)
  const result = await poller.pollUntilDone()

  if (result.status === 'Succeeded') {
    return {
      success: true,
      message: 'Email sent successfully via Azure Communication Services',
    }
  }
  throw new Error(`Azure Communication Services failed with status: ${result.status}`)
}

export async function sendBatchEmails(emails: TransactionalBatchEmail[]): Promise<SendEmailResult> {
  try {
    const { resend } = await resolveEmailClients()
    if (resend) {
      try {
        const batch = await Promise.all(
          emails.map(async ({ from, to, subject, html, text }) => ({
            from: from || (await getFromEmailAddress()),
            to,
            subject,
            html: html || undefined,
            text: text || undefined,
          }))
        )
        const { error } = await resend.batch.send(batch)
        if (error) throw new Error(error.message || 'Resend batch API error')
        return { success: true, message: 'All batch emails sent successfully via Resend' }
      } catch (error) {
        logger.warn('Resend batch failed, falling back to individual sends:', error)
      }
    }

    let successCount = 0
    for (const email of emails) {
      if ((await sendEmail(email)).success) successCount++
    }
    return successCount === emails.length
      ? { success: true, message: 'All batch emails sent successfully' }
      : { success: false, message: `${successCount}/${emails.length} emails sent successfully` }
  } catch (error) {
    logger.error('Error in batch email sending:', error)
    return { success: false, message: 'Failed to send batch emails' }
  }
}

async function resolveEmailClients(): Promise<EmailClients> {
  const [resendConfig, azureConfig] = await Promise.all([
    resolveResendServiceConfig(),
    resolveAzureCommunicationEmailServiceConfig(),
  ])

  return {
    resend:
      resendConfig.apiKey && resendConfig.apiKey !== 'placeholder'
        ? new Resend(resendConfig.apiKey)
        : null,
    azureEmailClient: azureConfig.connectionString
      ? new EmailClient(azureConfig.connectionString)
      : null,
  }
}
