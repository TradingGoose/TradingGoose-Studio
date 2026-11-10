/** @vitest-environment node */
import type { EmailClientOptions } from '@azure/communication-email'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type FrozenFinancialEmail,
  parseFrozenFinancialEmail,
  prepareFinancialEmail,
  sendFinancialEmail,
} from './financial-email'

type AzureHttpClient = NonNullable<EmailClientOptions['httpClient']>
type AzureRequest = Parameters<AzureHttpClient['sendRequest']>[0]
type AzureResponse = Awaited<ReturnType<AzureHttpClient['sendRequest']>>
const state = vi.hoisted(() => ({
  resend: vi.fn(),
  azure: vi.fn(),
  unsubscribed: vi.fn(),
  token: vi.fn(),
  azureHttp: vi.fn<AzureHttpClient['sendRequest']>(),
  azureOptions: [] as EmailClientOptions[],
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveResendServiceConfig: state.resend,
  resolveAzureCommunicationEmailServiceConfig: state.azure,
}))
vi.mock('@/lib/email/unsubscribe', () => ({
  isUnsubscribed: state.unsubscribed,
  generateUnsubscribeToken: state.token,
}))
vi.mock('@/lib/email/utils', () => ({
  getFromEmailAddress: async () => 'TradingGoose <billing@example.invalid>',
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://studio.example.invalid' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@azure/communication-email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@azure/communication-email')>()
  return {
    ...actual,
    EmailClient: class extends actual.EmailClient {
      constructor(connectionString: string, options?: EmailClientOptions) {
        state.azureOptions.push(options ?? {})
        super(connectionString, { ...options, httpClient: { sendRequest: state.azureHttp } })
      }
    },
  }
})

const operationId = '550e8400-e29b-41d4-a716-446655440000'
const resendId = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794'
const azureOrigin = 'https://fixture.communication.azure.com'
const connectionString = `endpoint=${azureOrigin}/;accesskey=ZmFrZS1rZXk=`
const mail = {
  to: 'original@example.invalid',
  subject: 'Original financial notice',
  html: '<p>Original {{UNSUBSCRIBE_TOKEN}}</p>',
  text: 'Original {{UNSUBSCRIBE_TOKEN}}',
  replyTo: 'billing@example.invalid',
  emailType: 'updates' as const,
  locale: 'en-US',
}
const fetchMock = vi.fn<typeof fetch>()
const sendOptions = () => ({
  requestKey: 'financial-notice/original-marker',
  firstContactAtMs: Date.now(),
  deadlineAt: Date.now() + 20_000,
  reconcile: false,
  azureOperationId: operationId,
})
async function ready(): Promise<FrozenFinancialEmail> {
  const prepared = await prepareFinancialEmail(mail)
  expect(prepared.status).toBe('ready')
  if (prepared.status !== 'ready') throw new Error('Expected ready financial email fixture')
  return prepared.envelope
}
function response(body: unknown, status = 200, responseHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...responseHeaders },
  })
}
function azureResponse(request: AzureRequest, status: number, body: unknown): AzureResponse {
  const values = new Map([
    ['content-type', 'application/json'],
    ['operation-location', `${azureOrigin}/emails/operations/${operationId}`],
    ['retry-after', '0'],
  ])
  return {
    request,
    status,
    bodyAsText: JSON.stringify(body),
    headers: {
      get: (name) => values.get(name.toLowerCase()),
      set: (name, value) => {
        values.set(name.toLowerCase(), String(value))
      },
      has: (name) => values.has(name.toLowerCase()),
      delete: (name) => {
        values.delete(name.toLowerCase())
      },
      toJSON: () => Object.fromEntries(values),
      [Symbol.iterator]: () => values[Symbol.iterator](),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  state.azureOptions.length = 0
  state.resend.mockResolvedValue({ apiKey: 're_fake_secret' })
  state.azure.mockResolvedValue({ connectionString })
  state.unsubscribed.mockResolvedValue(false)
  state.token.mockReturnValue('frozen-token')
  fetchMock.mockImplementation(async () => response({ id: resendId }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('financial email preparation', () => {
  it('freezes processed recipient/locale/headers/body once without service secrets', async () => {
    const envelope = await ready()
    expect(envelope.provider).toBe('resend')
    expect(envelope.locale).toBe('en-US')
    expect(envelope.requestJson).toContain('Original frozen-token')
    expect(envelope.requestJson).toContain('List-Unsubscribe')
    expect(JSON.stringify(envelope)).not.toContain('re_fake_secret')
    expect(parseFrozenFinancialEmail(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope)
    expect(fetchMock).not.toHaveBeenCalled()

    state.token.mockReturnValue('new-token')
    state.unsubscribed.mockResolvedValue(true)
    const result = await sendFinancialEmail(envelope, sendOptions())
    expect(result).toEqual({ status: 'accepted', providerId: resendId })
    expect(state.unsubscribed).toHaveBeenCalledOnce()
    expect(state.token).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.body).toBe(envelope.requestJson)
  })
  it('suppresses an opted-out unsent notification before provider contact', async () => {
    state.unsubscribed.mockResolvedValue(true)
    expect(await prepareFinancialEmail(mail)).toMatchObject({ status: 'suppressed' })
    expect(state.token).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('keeps critical transactional notices under existing opt-out policy', async () => {
    state.unsubscribed.mockResolvedValue(true)
    expect(await prepareFinancialEmail({ ...mail, emailType: 'transactional' })).toMatchObject({
      status: 'ready',
    })
    expect(state.unsubscribed).not.toHaveBeenCalled()
  })
  it('never turns missing provider into the generic mailer mock success', async () => {
    state.resend.mockResolvedValue({ apiKey: '' })
    state.azure.mockResolvedValue({ connectionString: '' })
    expect(await prepareFinancialEmail(mail)).toMatchObject({ status: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.azureHttp).not.toHaveBeenCalled()
  })
  it.each([
    { to: ['one@example.invalid', 'two@example.invalid'] },
    { attachments: [{ filename: 'x', content: 'x', contentType: 'text/plain' }] },
    { html: 'x'.repeat(128 * 1024 + 1) },
  ])('rejects unsupported or unbounded financial payloads: %j', async (override) => {
    expect(await prepareFinancialEmail({ ...mail, ...override })).toMatchObject({
      status: 'unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects changed frozen request/provider/recipient before contact', async () => {
    const envelope = await ready()
    for (const changed of [
      { ...envelope, requestJson: envelope.requestJson.replace('Original', 'Changed') },
      { ...envelope, provider: 'azure' as const },
      { ...envelope, recipient: 'different@example.invalid' },
    ]) {
      expect(() => parseFrozenFinancialEmail(changed)).toThrow()
      expect(await sendFinancialEmail(changed, sendOptions())).toMatchObject({
        status: 'not-contacted',
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('installed Resend financial transport', () => {
  it('replays identical bytes/key only inside the original conservative window', async () => {
    const envelope = await ready()
    const options = {
      ...sendOptions(),
      firstContactAtMs: Date.now() - 22 * 60 * 60 * 1000,
      reconcile: true,
    }
    await expect(sendFinancialEmail(envelope, options)).resolves.toMatchObject({
      status: 'accepted',
    })
    await expect(sendFinancialEmail(envelope, options)).resolves.toMatchObject({
      status: 'accepted',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('https://api.resend.com/emails')
      expect(init?.body).toBe(envelope.requestJson)
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(options.requestKey)
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })
  it('does not renew the23-hour window on retry', async () => {
    const envelope = await ready()
    await expect(
      sendFinancialEmail(envelope, {
        ...sendOptions(),
        firstContactAtMs: Date.now() - 23 * 60 * 60 * 1000,
        reconcile: true,
      })
    ).resolves.toMatchObject({ status: 'uncertain' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('uses ID readback outside the replay window and verifies original identity', async () => {
    const envelope = await ready()
    const original = JSON.parse(envelope.requestJson)
    fetchMock.mockResolvedValue(
      response({
        ...original,
        id: resendId,
        last_event: 'queued',
        reply_to: original.reply_to,
        html: original.html,
        text: original.text,
      })
    )
    const options = {
      ...sendOptions(),
      providerId: resendId,
      firstContactAtMs: Date.now() - 24 * 60 * 60 * 1000,
      reconcile: true,
    }
    await expect(sendFinancialEmail(envelope, options)).resolves.toEqual({
      status: 'accepted',
      providerId: resendId,
      submissionStatus: 'queued',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.resend.com/emails/${resendId}`)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET')
    fetchMock.mockResolvedValue(
      response({ ...original, id: resendId, last_event: 'sent', to: ['different@example.invalid'] })
    )
    await expect(sendFinancialEmail(envelope, options)).resolves.toMatchObject({
      status: 'uncertain',
    })
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  })
  it.each([
    [{ name: 'concurrent_idempotent_requests', statusCode: 409 }, 409],
    [{ name: 'application_error', statusCode: 500 }, 500],
    [{ success: false }, 200],
    [{ id: 'mock-email-id' }, 200],
    [{ id: resendId, success: false }, 200],
  ])(
    'keeps failed/mock/uncertain acknowledgement pending without retry or fallback: %j',
    async (body, status) => {
      const envelope = await ready()
      fetchMock.mockResolvedValue(response(body, Number(status), { 'retry-after': '60' }))
      const result = await sendFinancialEmail(envelope, sendOptions())
      expect(result).toMatchObject({ status: 'uncertain', retryAfterMs: 60_000 })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(state.azureHttp).not.toHaveBeenCalled()
    }
  )
  it('keeps a frozen Resend notification pinned when only Azure remains configured', async () => {
    const envelope = await ready()
    state.resend.mockResolvedValue({ apiKey: '' })
    await expect(sendFinancialEmail(envelope, sendOptions())).resolves.toMatchObject({
      status: 'not-contacted',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.azureHttp).not.toHaveBeenCalled()
  })
  it('aborts the actual SDK fetch at the fixed remaining quantum deadline', async () => {
    const envelope = await ready()
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    )
    await expect(
      sendFinancialEmail(envelope, { ...sendOptions(), deadlineAt: Date.now() + 15 })
    ).resolves.toMatchObject({ status: 'uncertain' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('does not begin provider contact after the incoming deadline', async () => {
    const envelope = await ready()
    await expect(
      sendFinancialEmail(envelope, { ...sendOptions(), deadlineAt: Date.now() })
    ).resolves.toMatchObject({ status: 'not-contacted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('installed Azure Email client and genuine poller', () => {
  beforeEach(() => {
    state.resend.mockResolvedValue({ apiKey: '' })
  })
  it('persists a genuine handle after POST and resumes only GET with the same operation identity', async () => {
    let reads = 0
    state.azureHttp.mockImplementation(async (request) =>
      azureResponse(request, request.method === 'POST' ? 202 : 200, {
        id: operationId,
        status: request.method === 'POST' || ++reads === 1 ? 'Running' : 'Succeeded',
      })
    )
    const envelope = await ready()
    const options = sendOptions()
    const initial = await sendFinancialEmail(envelope, options)
    expect(initial.status).toBe('progress')
    if (initial.status !== 'progress') throw new Error('Expected actual SDK poller handle')
    expect(initial.azureResumeFrom).toContain(operationId)
    expect(initial.azureResumeFrom).not.toContain('ZmFrZS1rZXk=')
    const resumed = await sendFinancialEmail(envelope, {
      ...options,
      reconcile: true,
      azureResumeFrom: initial.azureResumeFrom,
    })
    expect(resumed).toEqual({
      status: 'accepted',
      providerId: operationId,
      submissionStatus: 'Succeeded',
    })
    expect(state.azureHttp.mock.calls.map(([request]) => request.method)).toEqual([
      'POST',
      'GET',
      'GET',
    ])
    expect(state.azureHttp.mock.calls[0][0].abortSignal).toBe(
      state.azureHttp.mock.calls[1][0].abortSignal
    )
    expect(state.azureHttp.mock.calls[2][0].abortSignal).not.toBe(
      state.azureHttp.mock.calls[0][0].abortSignal
    )
    expect(state.azureHttp.mock.calls[0][0].headers.get('Operation-Id')).toBe(operationId)
    expect(state.azureOptions.every((options) => options.retryOptions?.maxRetries === 0)).toBe(true)
    expect(state.azureHttp.mock.calls.every(([request]) => request.abortSignal)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not repeat a lost initial acknowledgement from operationId alone', async () => {
    state.azureHttp.mockRejectedValue(new Error('Lost acknowledgement after possible contact'))
    const envelope = await ready()
    const options = sendOptions()
    await expect(sendFinancialEmail(envelope, options)).resolves.toMatchObject({
      status: 'uncertain',
    })
    await expect(
      sendFinancialEmail(envelope, { ...options, reconcile: true })
    ).resolves.toMatchObject({ status: 'uncertain' })
    expect(state.azureHttp).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('retains a terminal failure without pretending accepted submission', async () => {
    state.azureHttp.mockImplementation(async (request) =>
      azureResponse(request, request.method === 'POST' ? 202 : 200, {
        id: operationId,
        status: request.method === 'POST' ? 'Running' : 'Failed',
      })
    )
    await expect(sendFinancialEmail(await ready(), sendOptions())).resolves.toMatchObject({
      status: 'uncertain',
    })
    expect(state.azureHttp.mock.calls.map(([request]) => request.method)).toEqual(['POST', 'GET'])
  })
  it('does not contact a changed configured Azure target', async () => {
    const envelope = await ready()
    state.azure.mockResolvedValue({
      connectionString: 'endpoint=https://other.communication.azure.com/;accesskey=ZmFrZS1rZXk=',
    })
    await expect(sendFinancialEmail(envelope, sendOptions())).resolves.toMatchObject({
      status: 'not-contacted',
    })
    expect(state.azureHttp).not.toHaveBeenCalled()
  })
  it('aborts the actual Azure HTTP request and never retries it', async () => {
    state.azureHttp.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) => {
          request.abortSignal?.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          })
        })
    )
    const envelope = await ready()
    await expect(
      sendFinancialEmail(envelope, { ...sendOptions(), deadlineAt: Date.now() + 15 })
    ).resolves.toMatchObject({ status: 'uncertain' })
    expect(state.azureHttp).toHaveBeenCalledOnce()
    expect(state.azureHttp.mock.calls[0][0].abortSignal?.aborted).toBe(true)
  })
  it('blocks a foreign operation URL through the public Azure pipeline before another contact', async () => {
    state.azureHttp.mockImplementation(async (request) => {
      const result = azureResponse(request, 202, { id: operationId, status: 'Running' })
      result.headers.set(
        'operation-location',
        `https://different.example.invalid/emails/operations/${operationId}`
      )
      return result
    })
    await expect(sendFinancialEmail(await ready(), sendOptions())).resolves.toMatchObject({
      status: 'uncertain',
    })
    expect(state.azureHttp).toHaveBeenCalledOnce()
    expect(state.azureHttp.mock.calls[0][0].url).toContain(azureOrigin)
  })
  it('disables actual Azure transport retries for server errors', async () => {
    state.azureHttp.mockImplementation(async (request) =>
      azureResponse(request, 500, { error: { code: 'ServerError', message: 'Provider failed' } })
    )
    await expect(sendFinancialEmail(await ready(), sendOptions())).resolves.toMatchObject({
      status: 'uncertain',
    })
    expect(state.azureHttp).toHaveBeenCalledOnce()
  })
})
