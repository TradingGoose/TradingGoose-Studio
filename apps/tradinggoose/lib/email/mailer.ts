import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { getEmailCopy } from '@/components/emails/email-copy'
import {
  generateUnsubscribeToken,
  getEmailRecipient,
  isUnsubscribed,
  type MailingList,
} from '@/lib/email/unsubscribe'
import { getFromEmailAddress } from '@/lib/email/utils'
import { createLogger } from '@/lib/logs/console/logger'
import {
  resolveAzureCommunicationEmailServiceConfig,
  resolveResendServiceConfig,
} from '@/lib/system-services/runtime'
import { getBaseUrl } from '@/lib/urls/utils'
import { type LocaleInput, localizeUrl } from '@/i18n/utils'

const logger = createLogger('Mailer')

interface EmailAttachment {
  filename: string
  content: string | Buffer
  contentType: string
  disposition?: 'attachment' | 'inline'
}

type EmailOptions = {
  subject: string
  text?: string
  from?: string
  attachments?: EmailAttachment[]
  replyTo?: string
  locale?: LocaleInput
} & (
  | { emailType: 'transactional'; to: string | string[]; html?: string }
  | {
      emailType: MailingList
      to: string
      html?: (unsubscribeUrl: string) => Promise<string>
    }
)

export type TransactionalBatchEmail = Pick<
  Extract<EmailOptions, { emailType: 'transactional' }>,
  'emailType' | 'from' | 'to' | 'subject' | 'html' | 'text'
>

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

/**
 * Check if any email service is configured and available
 */
export async function hasEmailService(): Promise<boolean> {
  const clients = await resolveEmailClients()
  return Boolean(clients.resend || clients.azureEmailClient)
}

export async function addVerifiedUserEmailToAudience(
  verifiedUser: Pick<typeof user.$inferSelect, 'id'>,
  previousEmail?: string
): Promise<void> {
  try {
    const { apiKey, audienceId: segmentId } = await resolveResendServiceConfig()
    if (!apiKey || !segmentId) return

    const recipient = await getEmailRecipient(eq(user.id, verifiedUser.id))
    if (!recipient?.emailVerified) return

    const { contacts } = new Resend(apiKey)
    const email = recipient.email.trim().toLowerCase()
    const getContact = async (address: string) => {
      const { data, error } = await contacts.get({ email: address })
      if (error && error.statusCode !== 404) throw error
      return data
    }
    const previousContact =
      previousEmail &&
      previousEmail !== email &&
      !(await getEmailRecipient(eq(user.email, previousEmail)))?.emailVerified
        ? await getContact(previousEmail)
        : null
    const unsubscribed =
      !!previousContact?.unsubscribed || isUnsubscribed(recipient.preferences, 'marketing')
    const contact = await getContact(email)
    if (!contact) {
      const { error } = await contacts.create({
        email,
        unsubscribed,
        segments: [{ id: segmentId }],
      })
      if (error) throw error
    } else {
      if (unsubscribed && !contact.unsubscribed) {
        const { error } = await contacts.update({ id: contact.id, unsubscribed: true })
        if (error) throw error
      }
      const { error } = await contacts.segments.add({ contactId: contact.id, segmentId })
      if (error) throw error
    }
    if (
      previousContact &&
      !(await getEmailRecipient(eq(user.email, previousContact.email)))?.emailVerified
    ) {
      const { error } = await contacts.segments.remove({ contactId: previousContact.id, segmentId })
      if (error && error.statusCode !== 404) throw error
    }
  } catch (error) {
    logger.warn('Failed to synchronize verified user email with Resend', {
      userId: verifiedUser.id,
      error,
    })
  }
}

export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  try {
    const clients = await resolveEmailClients()
    const { to, subject, from, emailType, attachments, replyTo, locale } = options
    let html = emailType === 'transactional' ? options.html : undefined
    let text = options.text
    const headers: Record<string, string> = {}

    if (emailType !== 'transactional') {
      const recipient = await getEmailRecipient(eq(user.email, to))
      if (!recipient) return { success: false, message: 'Email recipient no longer exists' }
      if (isUnsubscribed(recipient.preferences, emailType)) {
        logger.info('Email not sent (user unsubscribed):', { to, subject, emailType })
        return {
          success: true,
          message: 'Email skipped (user unsubscribed)',
        }
      }
      const token = generateUnsubscribeToken(recipient, emailType)
      const params = new URLSearchParams({ token, email: to })
      const baseUrl = getBaseUrl()
      const unsubscribeUrl = `${localizeUrl(baseUrl, locale, '/unsubscribe')}?${params}`
      headers['List-Unsubscribe'] = `<${baseUrl}/api/users/me/settings/unsubscribe?${params}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
      html = await options.html?.(unsubscribeUrl)
      if (text) text += `\n\n${getEmailCopy(locale).footer.unsubscribe}: ${unsubscribeUrl}`
    }

    const senderEmail = from || (await getFromEmailAddress())
    const processedData = { to, subject, html, text, senderEmail, headers, attachments, replyTo }

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

    return {
      success: false,
      message: 'No email service configured',
    }
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
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
