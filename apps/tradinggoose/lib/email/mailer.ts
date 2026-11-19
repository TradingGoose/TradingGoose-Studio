import { EmailClient } from '@azure/communication-email'
import { db } from '@tradinggoose/db'
import { user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type ErrorResponse, Resend } from 'resend'
import { getEmailCopy } from '@/components/emails/email-copy'
import {
  generateUnsubscribeToken,
  getEmailRecipient,
  isUnsubscribed,
  type MailingList,
  unsubscribeFromList,
} from '@/lib/email/unsubscribe'
import { getFromEmailAddress } from '@/lib/email/utils'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
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
  content: string
  contentType: string
}

type EmailOptions = {
  subject: string
  text?: string
  from?: string
  attachments?: EmailAttachment[]
  replyTo?: string
  locale?: LocaleInput
} & (
  | { emailType: 'transactional'; to: string; userId?: string; html?: string }
  | {
      emailType: MailingList
      to: string
      userId: string
      html: (unsubscribeUrl: string) => Promise<string>
    }
)

export interface TransactionalBatchEmail {
  to: string
  subject: string
  html: string
}

interface SendEmailResult {
  success: boolean
  message: string
  currentEmail?: string
}

export async function hasEmailService(): Promise<boolean> {
  const clients = await resolveEmailClients()
  return Boolean(clients.resend || clients.azureEmailClient)
}

export async function syncUserEmailAudience(
  account: Pick<typeof user.$inferSelect, 'id'>,
  previousEmail?: string
): Promise<boolean> {
  try {
    const { apiKey, audienceId: segmentId } = await resolveResendServiceConfig()
    if (!apiKey || !segmentId) return true
    const { contacts } = new Resend(apiKey)
    const checkResponse = (error: ErrorResponse | null, allowMissing = false) => {
      if (error && !(allowMissing && error.statusCode === 404)) {
        throw Object.assign(new Error(error.message), error)
      }
    }
    const getContact = async (email: string) => {
      const { data, error } = await contacts.get({ email })
      checkResponse(error, true)
      return data
    }
    const getOwner = (email: string) => getEmailRecipient(eq(user.email, email))
    const wantsMarketing = (owner: Awaited<ReturnType<typeof getOwner>>) =>
      !!owner?.emailVerified && !isUnsubscribed(owner.preferences, 'marketing')
    const syncMembership = async (email: string, enroll: boolean) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (enroll) {
          const contact = await getContact(email)
          if (contact?.unsubscribed) return
          const { error } = contact
            ? await contacts.segments.add({ contactId: contact.id, segmentId })
            : await contacts.create({ email, segments: [{ id: segmentId }] })
          checkResponse(error)
        } else {
          const { error } = await contacts.segments.remove({ email, segmentId })
          checkResponse(error, true)
        }

        // A concurrent sync can finish while the Resend write is in flight.
        const desired = wantsMarketing(await getOwner(email))
        if (enroll === desired) return
        enroll = desired
      }
      throw new Error('Mailbox ownership or consent changed again during segment synchronization')
    }

    const prior = previousEmail?.trim().toLowerCase()
    const syncCurrentAddress = async () => {
      const recipient = await getEmailRecipient(eq(user.id, account.id))
      if (!recipient) return
      const email = recipient.email.trim().toLowerCase()
      let optedOut = isUnsubscribed(recipient.preferences, 'marketing')
      if (!optedOut && prior && prior !== email && !(await getOwner(prior))?.emailVerified) {
        if ((await getContact(prior))?.unsubscribed) {
          await unsubscribeFromList(db, recipient.id, 'marketing')
          optedOut = true
        }
      }
      if (optedOut || recipient.emailVerified) {
        await syncMembership(email, !optedOut)
      }
    }

    const changes = [syncCurrentAddress]
    if (prior) {
      let cleanupStarted = false
      changes.push(async () => {
        const owner = await getOwner(prior)
        if (owner?.emailVerified && !cleanupStarted) return
        cleanupStarted = true
        await syncMembership(prior, wantsMarketing(owner))
      })
    }
    const [current, previous] = await Promise.allSettled(
      changes.map((change) =>
        retryWithExponentialBackoff(change, {
          maxRetries: 1,
          retryCondition: (error) =>
            ('statusCode' in error &&
              (error.statusCode === null ||
                (typeof error.statusCode === 'number' && error.statusCode >= 500))) ||
            ('name' in error && error.name === 'rate_limit_exceeded'),
        })
      )
    )
    if (previous?.status === 'rejected') {
      logger.warn(
        'Failed to reconcile the previous mailbox in the Resend segment',
        { userId: account.id, previousEmail: prior, segmentId },
        previous.reason
      )
    }
    if (current.status === 'rejected') throw current.reason
    return previous?.status !== 'rejected'
  } catch (error) {
    logger.warn('Failed to synchronize verified user email with Resend', {
      userId: account.id,
      error,
    })
    return false
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
      const token = generateUnsubscribeToken({ id: options.userId, email: to }, emailType)
      const params = new URLSearchParams({ token, email: to })
      const baseUrl = getBaseUrl()
      const unsubscribeUrl = `${localizeUrl(baseUrl, locale, '/unsubscribe')}?${params}`
      headers['List-Unsubscribe'] = `<${baseUrl}/api/users/me/settings/unsubscribe?${params}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
      html = await options.html(unsubscribeUrl)
      if (text) text += `\n\n${getEmailCopy(locale).footer.unsubscribe}: ${unsubscribeUrl}`
    }

    const senderEmail = from || (await getFromEmailAddress())
    const checkRecipient = async (): Promise<SendEmailResult | undefined> => {
      if (options.userId === undefined) return
      const recipient = await getEmailRecipient(eq(user.id, options.userId))
      if (!recipient || recipient.email !== to) {
        return {
          success: false,
          message: 'Email recipient address has changed or no longer exists',
          currentEmail: recipient?.emailVerified ? recipient.email : undefined,
        }
      }
      if (emailType !== 'transactional' && isUnsubscribed(recipient.preferences, emailType)) {
        return { success: true, message: 'Email skipped (user unsubscribed)' }
      }
    }
    const skipped = await checkRecipient()
    if (skipped) return skipped
    const body = html ? { html, text } : text ? { text } : null
    if (!body) throw new Error('Email content is required')

    if (clients.resend) {
      try {
        const { error } = await clients.resend.emails.send({
          ...body,
          from: senderEmail,
          to,
          subject,
          headers: Object.keys(headers).length ? headers : undefined,
          attachments,
          replyTo,
        })
        if (error) throw new Error(error.message)
        return { success: true, message: 'Email sent successfully via Resend' }
      } catch (error) {
        if (!clients.azureEmailClient) throw error
        logger.warn('Resend failed, attempting Azure Communication Services fallback:', error)
        const skipped = await checkRecipient()
        if (skipped) return skipped
      }
    }

    if (!clients.azureEmailClient) return { success: false, message: 'No email service configured' }
    try {
      const poller = await clients.azureEmailClient.beginSend({
        senderAddress: senderEmail.match(/<(.+)>/)?.[1] ?? senderEmail,
        content:
          body.html !== undefined
            ? { subject, html: body.html, plainText: body.text }
            : { subject, plainText: body.text },
        recipients: { to: [{ address: to }] },
        attachments: attachments?.map(({ filename, content, contentType }) => ({
          name: filename,
          contentInBase64: content,
          contentType,
        })),
        replyTo: replyTo ? [{ address: replyTo }] : undefined,
        headers,
      })
      const { status } = await poller.pollUntilDone()
      if (status !== 'Succeeded') throw new Error(`Azure email send failed: ${status}`)
      return { success: true, message: 'Email sent successfully via Azure Communication Services' }
    } catch (error) {
      logger.error('Azure Communication Services failed:', error)
      return { success: false, message: 'Both Resend and Azure Communication Services failed' }
    }
  } catch (error) {
    logger.error('Error sending email:', error)
    return {
      success: false,
      message: 'Failed to send email',
    }
  }
}

export async function sendBatchEmails(emails: TransactionalBatchEmail[]): Promise<SendEmailResult> {
  try {
    const { resend } = await resolveEmailClients()
    if (resend) {
      try {
        const from = await getFromEmailAddress()
        const batch = emails.map(({ to, subject, html }) => ({ from, to, subject, html }))
        const { error } = await resend.batch.send(batch)
        if (error) throw new Error(error.message || 'Resend batch API error')
        return { success: true, message: 'All batch emails sent successfully via Resend' }
      } catch (error) {
        logger.warn('Resend batch failed, falling back to individual sends:', error)
      }
    }

    let successCount = 0
    for (const email of emails) {
      if ((await sendEmail({ ...email, emailType: 'transactional' })).success) successCount++
    }
    return successCount === emails.length
      ? { success: true, message: 'All batch emails sent successfully' }
      : { success: false, message: `${successCount}/${emails.length} emails sent successfully` }
  } catch (error) {
    logger.error('Error in batch email sending:', error)
    return { success: false, message: 'Failed to send batch emails' }
  }
}

async function resolveEmailClients() {
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
