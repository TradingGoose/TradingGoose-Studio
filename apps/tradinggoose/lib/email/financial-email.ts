import { createHash } from 'node:crypto'
import { EmailClient, type EmailMessage } from '@azure/communication-email'
import { type CreateEmailResponseSuccess, type GetEmailResponseSuccess, Resend } from 'resend'
import { z } from 'zod'
import { type EmailOptions, processEmailData } from '@/lib/email/mailer'
import { isUnsubscribed } from '@/lib/email/unsubscribe'
import {
  resolveAzureCommunicationEmailServiceConfig,
  resolveResendServiceConfig,
} from '@/lib/system-services/runtime'

const RESEND_TARGET = 'https://api.resend.com'
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000
const MAX_REQUEST_BYTES = 128 * 1024
const MAX_RESUME_BYTES = 64 * 1024
const address = z.string().email()
const emailType = z.enum(['transactional', 'marketing', 'updates', 'notifications'])
const headers = z.record(z.string(), z.string())
const resendRequest = z
  .object({
    from: z.string().min(1),
    to: z.tuple([address]),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
    headers,
    reply_to: z.tuple([address]).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.html || value.text), 'Email content is required')
const resendReadback = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    subject: z.string(),
    html: z.string().nullable(),
    text: z.string().nullable(),
    reply_to: z.array(z.string()).nullable(),
    last_event: z.enum([
      'bounced',
      'canceled',
      'clicked',
      'complained',
      'delivered',
      'delivery_delayed',
      'failed',
      'opened',
      'queued',
      'scheduled',
      'sent',
    ]),
  })
  .passthrough()
  .refine((value) => !('success' in value))
const azureRequest = z
  .object({
    senderAddress: address,
    content: z.union([
      z
        .object({
          subject: z.string().min(1),
          html: z.string().min(1),
          plainText: z.string().optional(),
        })
        .strict(),
      z
        .object({
          subject: z.string().min(1),
          plainText: z.string().min(1),
          html: z.string().optional(),
        })
        .strict(),
    ]),
    recipients: z.object({ to: z.tuple([z.object({ address }).strict()]) }).strict(),
    headers,
    replyTo: z.tuple([z.object({ address }).strict()]).optional(),
  })
  .strict()
const envelopeSchema = z
  .object({
    version: z.literal(1),
    provider: z.enum(['resend', 'azure']),
    providerTarget: z.string().max(2048),
    recipient: address,
    emailType,
    locale: z.string().max(128).nullable(),
    requestJson: z.string().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export type FrozenFinancialEmail = z.infer<typeof envelopeSchema>
export type PreparedFinancialEmail =
  | { status: 'ready'; envelope: FrozenFinancialEmail }
  | { status: 'suppressed' | 'unavailable'; reason: string }
export type FinancialEmailResult =
  | { status: 'accepted'; providerId: string; submissionStatus?: string }
  | { status: 'not-contacted'; reason: string; retryAfterMs?: number }
  | {
      status: 'uncertain'
      reason: string
      providerId?: string
      azureResumeFrom?: string
      retryAfterMs?: number
    }
  | { status: 'progress'; azureResumeFrom: string; providerId?: string }
export interface FinancialEmailSendOptions {
  requestKey: string
  firstContactAtMs: number
  deadlineAt: number
  reconcile: boolean
  providerId?: string
  azureOperationId?: string
  azureResumeFrom?: string
}

function fingerprint(envelope: Omit<FrozenFinancialEmail, 'fingerprint'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: envelope.version,
        provider: envelope.provider,
        providerTarget: envelope.providerTarget,
        recipient: envelope.recipient,
        emailType: envelope.emailType,
        locale: envelope.locale,
        requestJson: envelope.requestJson,
      })
    )
    .digest('hex')
}

function azureTarget(connectionString: string): string {
  const endpoint = connectionString.split(';').find((part) => /^endpoint=/i.test(part.trim()))
  if (!endpoint) throw new Error('Azure Email endpoint is missing')
  const url = new URL(endpoint.trim().slice(endpoint.trim().indexOf('=') + 1))
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Azure Email endpoint must be an HTTPS origin')
  return url.origin
}

/** Receipt-bound bytes only. This never resolves recipients, preferences or a new provider. */
export function parseFrozenFinancialEmail(input: unknown): FrozenFinancialEmail {
  const envelope = envelopeSchema.parse(input)
  if (Buffer.byteLength(envelope.requestJson) > MAX_REQUEST_BYTES)
    throw new Error('Financial email request exceeds its bound')
  if (fingerprint(envelope) !== envelope.fingerprint)
    throw new Error('Financial email fingerprint does not match frozen bytes')
  const raw: unknown = JSON.parse(envelope.requestJson)
  if (envelope.provider === 'resend') {
    const request = resendRequest.parse(raw)
    if (envelope.providerTarget !== RESEND_TARGET || request.to[0] !== envelope.recipient)
      throw new Error('Financial email provider/recipient binding changed')
  } else {
    const request = azureRequest.parse(raw)
    if (
      azureTarget(`endpoint=${envelope.providerTarget}`) !== envelope.providerTarget ||
      request.recipients.to[0].address !== envelope.recipient
    )
      throw new Error('Financial email provider/recipient binding changed')
  }
  return Object.freeze(envelope)
}

/** Caller persists the ready envelope and original request identity before any send. */
export async function prepareFinancialEmail(
  options: EmailOptions
): Promise<PreparedFinancialEmail> {
  try {
    const recipients = Array.isArray(options.to) ? options.to : [options.to]
    if (recipients.length !== 1 || options.attachments?.length)
      return {
        status: 'unavailable',
        reason: 'Financial email requires one recipient and no attachments',
      }
    const recipient = address.parse(recipients[0])
    const type = options.emailType ?? 'transactional'
    if (type !== 'transactional' && (await isUnsubscribed(recipient, type)))
      return { status: 'suppressed', reason: 'Recipient opted out before financial email contact' }
    const data = await processEmailData({ ...options, to: recipient })
    const resend = await resolveResendServiceConfig()
    let provider: FrozenFinancialEmail['provider']
    let providerTarget: string
    let request: unknown
    if (resend.apiKey) {
      if (process.env.RESEND_BASE_URL && process.env.RESEND_BASE_URL !== RESEND_TARGET)
        return {
          status: 'unavailable',
          reason: 'Financial Resend target must be its official HTTPS origin',
        }
      provider = 'resend'
      providerTarget = RESEND_TARGET
      request = resendRequest.parse({
        from: data.senderEmail,
        to: [recipient],
        subject: data.subject,
        ...(data.html !== undefined && { html: data.html }),
        ...(data.text !== undefined && { text: data.text }),
        headers: data.headers,
        ...(data.replyTo && { reply_to: [data.replyTo] }),
      })
    } else {
      const azure = await resolveAzureCommunicationEmailServiceConfig()
      if (!azure.connectionString)
        return { status: 'unavailable', reason: 'No financial email provider is configured' }
      provider = 'azure'
      providerTarget = azureTarget(azure.connectionString)
      request = azureRequest.parse({
        senderAddress: data.senderEmail.includes('<')
          ? data.senderEmail.match(/<([^<>]+)>/)?.[1]
          : data.senderEmail,
        content: {
          subject: data.subject,
          ...(data.html !== undefined && { html: data.html }),
          ...(data.text !== undefined && { plainText: data.text }),
        },
        recipients: { to: [{ address: recipient }] },
        headers: data.headers,
        ...(data.replyTo && { replyTo: [{ address: data.replyTo }] }),
      })
    }
    const frozen = {
      version: 1 as const,
      provider,
      providerTarget,
      recipient,
      emailType: type,
      locale: options.locale ?? null,
      requestJson: JSON.stringify(request),
    }
    return {
      status: 'ready',
      envelope: parseFrozenFinancialEmail({ ...frozen, fingerprint: fingerprint(frozen) }),
    }
  } catch {
    return {
      status: 'unavailable',
      reason: 'Financial email configuration or processed payload is unavailable',
    }
  }
}

function actualProviderId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 256 &&
    !/^(mock(?:[-_]|$)|skipped[-_])/i.test(value)
  )
}

function retryAfterMs(values: Record<string, string> | null): number | undefined {
  const value = values?.['retry-after']
  if (!value) return undefined
  const duration = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined
}

/** No database writes: caller alone acknowledges the original claim/fingerprint. */
export async function sendFinancialEmail(
  input: FrozenFinancialEmail,
  options: FinancialEmailSendOptions
): Promise<FinancialEmailResult> {
  let envelope: FrozenFinancialEmail
  try {
    envelope = parseFrozenFinancialEmail(input)
    if (
      !options.requestKey ||
      options.requestKey.length > 256 ||
      /[\r\n]/.test(options.requestKey) ||
      !Number.isSafeInteger(options.firstContactAtMs) ||
      options.firstContactAtMs < 0 ||
      options.firstContactAtMs > Date.now()
    )
      throw new Error('Invalid persisted financial email request identity')
  } catch {
    return {
      status: 'not-contacted',
      reason: 'Frozen financial email or original request identity is invalid',
    }
  }
  const remaining = Math.min(options.deadlineAt - Date.now(), 20_000)
  if (!Number.isFinite(remaining) || remaining <= 0)
    return { status: 'not-contacted', reason: 'Financial provider quantum expired before contact' }
  const signal = AbortSignal.timeout(Math.floor(remaining))
  if (envelope.provider === 'resend') {
    let contacted = false
    try {
      const config = await resolveResendServiceConfig()
      if (
        !config.apiKey ||
        (process.env.RESEND_BASE_URL && process.env.RESEND_BASE_URL !== envelope.providerTarget)
      )
        return { status: 'not-contacted', reason: 'Pinned Resend provider is unavailable' }
      if (signal.aborted)
        return {
          status: 'not-contacted',
          reason: 'Financial provider quantum expired before contact',
        }
      if (!options.providerId && Date.now() - options.firstContactAtMs >= REPLAY_WINDOW_MS)
        return {
          status: 'uncertain',
          reason: 'Original Resend replay window expired; provider classification required',
        }
      const resend = new Resend(config.apiKey)
      const requestHeaders = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      }
      if (options.providerId) {
        if (!actualProviderId(options.providerId))
          return { status: 'uncertain', reason: 'Original Resend provider reference is invalid' }
        contacted = true
        const response = await resend.fetchRequest<GetEmailResponseSuccess>(
          `/emails/${encodeURIComponent(options.providerId)}`,
          { method: 'GET', headers: requestHeaders, signal }
        )
        const readback = resendReadback.safeParse(response.data)
        const request = resendRequest.parse(JSON.parse(envelope.requestJson))
        if (response.error || !readback.success)
          return {
            status: 'uncertain',
            providerId: options.providerId,
            reason: 'Resend readback did not verify original submission',
            retryAfterMs: retryAfterMs(response.headers),
          }
        const data = readback.data
        if (
          data.id !== options.providerId ||
          data.from !== request.from ||
          JSON.stringify(data.to) !== JSON.stringify(request.to) ||
          data.subject !== request.subject ||
          (data.html ?? '') !== (request.html ?? '') ||
          (data.text ?? '') !== (request.text ?? '') ||
          JSON.stringify(data.reply_to ?? []) !== JSON.stringify(request.reply_to ?? [])
        )
          return {
            status: 'uncertain',
            providerId: options.providerId,
            reason: 'Resend readback did not verify original submission',
            retryAfterMs: retryAfterMs(response.headers),
          }
        return { status: 'accepted', providerId: data.id, submissionStatus: data.last_event }
      }
      contacted = true
      const response = await resend.fetchRequest<CreateEmailResponseSuccess>('/emails', {
        method: 'POST',
        headers: { ...requestHeaders, 'Idempotency-Key': options.requestKey },
        body: envelope.requestJson,
        signal,
      })
      const created = z.object({ id: z.string() }).strict().safeParse(response.data)
      if (response.error || !created.success || !actualProviderId(created.data.id))
        return {
          status: 'uncertain',
          reason: 'Resend submission requires original-request classification',
          retryAfterMs: retryAfterMs(response.headers),
        }
      return { status: 'accepted', providerId: created.data.id }
    } catch {
      return {
        status: contacted ? 'uncertain' : 'not-contacted',
        reason: 'Pinned Resend request requires classification',
        ...(options.providerId && { providerId: options.providerId }),
      }
    }
  }
  if (
    !options.azureOperationId ||
    !z.string().uuid().safeParse(options.azureOperationId).success ||
    (options.providerId && options.providerId !== options.azureOperationId)
  )
    return {
      status: 'not-contacted',
      reason: 'Original Azure operation UUID is missing or conflicting',
    }
  if (options.reconcile && !options.azureResumeFrom)
    return {
      status: 'uncertain',
      reason: 'Azure initial acknowledgement was lost without a genuine resumable handle',
      providerId: options.providerId,
    }
  if (options.azureResumeFrom && Buffer.byteLength(options.azureResumeFrom) > MAX_RESUME_BYTES)
    return {
      status: 'uncertain',
      reason: 'Retained Azure resume handle exceeds its supported bound',
      providerId: options.providerId,
    }
  let contacted = false
  try {
    const config = await resolveAzureCommunicationEmailServiceConfig()
    if (
      !config.connectionString ||
      azureTarget(config.connectionString) !== envelope.providerTarget
    )
      return { status: 'not-contacted', reason: 'Pinned Azure Email provider is unavailable' }
    if (signal.aborted)
      return {
        status: 'not-contacted',
        reason: 'Financial provider quantum expired before contact',
      }
    const message: EmailMessage = azureRequest.parse(JSON.parse(envelope.requestJson))
    const client = new EmailClient(config.connectionString, {
      retryOptions: { maxRetries: 0 },
      additionalPolicies: [
        {
          position: 'perCall',
          policy: {
            name: 'financialEmailProviderBoundary',
            async sendRequest(request, next) {
              if (new URL(request.url).origin !== envelope.providerTarget || signal.aborted)
                throw new Error('Pinned financial provider target or deadline changed')
              request.abortSignal = signal
              return next(request)
            },
          },
        },
      ],
    })
    contacted = true
    const poller = await client.beginSend(message, {
      operationId: options.azureOperationId,
      resumeFrom: options.azureResumeFrom,
      abortSignal: signal,
    })
    const result = poller.getResult()
    if (poller.isDone() && result?.status === 'Succeeded' && result.id === options.azureOperationId)
      return { status: 'accepted', providerId: result.id, submissionStatus: result.status }
    const azureResumeFrom = poller.toString()
    if (!azureResumeFrom || Buffer.byteLength(azureResumeFrom) > MAX_RESUME_BYTES)
      return {
        status: 'uncertain',
        reason: 'Azure submission has no bounded genuine resume handle',
      }
    if (poller.isDone())
      return {
        status: 'uncertain',
        reason: 'Azure provider did not accept the original submission',
        azureResumeFrom,
        providerId: result?.id,
      }
    return { status: 'progress', azureResumeFrom, ...(result?.id && { providerId: result.id }) }
  } catch {
    return {
      status: contacted ? 'uncertain' : 'not-contacted',
      reason: 'Azure submission acknowledgement requires classification',
      ...(options.providerId && { providerId: options.providerId }),
      ...(options.azureResumeFrom && { azureResumeFrom: options.azureResumeFrom }),
    }
  }
}
