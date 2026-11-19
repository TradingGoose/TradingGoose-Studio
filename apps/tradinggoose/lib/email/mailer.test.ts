import { isDeepStrictEqual } from 'node:util'
import { user } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()
const mockBatchSend = vi.fn()
const mockContactsCreate = vi.fn()
const mockContactsGet = vi.fn()
const mockContactSegmentAdd = vi.fn()
const mockContactSegmentRemove = vi.fn()
const mockAzureBeginSend = vi.fn()
const mockAzurePollUntilDone = vi.fn()
const {
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockResolveResendServiceConfig,
  mockResolveAzureCommunicationEmailServiceConfig,
} = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockResolveResendServiceConfig: vi.fn(),
  mockResolveAzureCommunicationEmailServiceConfig: vi.fn(),
}))

vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(function () {
      void new.target
      return {
        emails: {
          send: (...args: any[]) => mockSend(...args),
        },
        batch: {
          send: (...args: any[]) => mockBatchSend(...args),
        },
        contacts: {
          create: (...args: any[]) => mockContactsCreate(...args),
          get: (...args: any[]) => mockContactsGet(...args),
          segments: { add: mockContactSegmentAdd, remove: mockContactSegmentRemove },
        },
      }
    }),
  }
})

vi.mock('@azure/communication-email', () => {
  return {
    EmailClient: vi.fn().mockImplementation(function () {
      void new.target
      return {
        beginSend: (...args: any[]) => mockAzureBeginSend(...args),
      }
    }),
  }
})

vi.mock('@/lib/email/unsubscribe', () => ({
  isUnsubscribed: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
  unsubscribeFromList: vi.fn(),
  getEmailRecipient: vi.fn(),
}))

vi.mock('@/lib/email/utils', () => ({
  getFromEmailAddress: vi.fn().mockResolvedValue('TradingGoose <noreply@tradinggoose.ai>'),
}))

vi.mock('@/lib/system-services/runtime', () => ({
  resolveResendServiceConfig: mockResolveResendServiceConfig,
  resolveAzureCommunicationEmailServiceConfig: mockResolveAzureCommunicationEmailServiceConfig,
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://test.tradinggoose.ai'),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}))

import { sendBatchEmails, sendEmail, syncUserEmailAudience } from '@/lib/email/mailer'
import {
  generateUnsubscribeToken,
  getEmailRecipient,
  isUnsubscribed,
  unsubscribeFromList,
} from '@/lib/email/unsubscribe'

describe('mailer', () => {
  const testEmailOptions = {
    to: 'test@example.com',
    subject: 'Test Subject',
    html: '<p>Test email content</p>',
    emailType: 'transactional' as const,
  }
  const recipient = {
    id: 'user-123',
    email: testEmailOptions.to,
    emailVerified: true,
    preferences: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isUnsubscribed).mockReturnValue(false)
    vi.mocked(getEmailRecipient).mockResolvedValue(recipient)
    vi.mocked(generateUnsubscribeToken).mockReturnValue('mock-token-123')
    mockResolveResendServiceConfig.mockResolvedValue({
      apiKey: 'test-api-key',
      audienceId: 'audience-123',
    })
    mockResolveAzureCommunicationEmailServiceConfig.mockResolvedValue({
      connectionString: 'test-azure-connection-string',
    })

    // Mock successful Resend response
    mockSend.mockResolvedValue({
      data: { id: 'test-email-id' },
      error: null,
    })

    mockBatchSend.mockResolvedValue({
      data: [{ id: 'batch-email-1' }, { id: 'batch-email-2' }],
      error: null,
    })

    mockContactsCreate.mockResolvedValue({
      data: { id: 'contact-123', object: 'contact' },
      error: null,
      headers: null,
    })
    mockContactsGet.mockResolvedValue({ data: null, error: { statusCode: 404 } })
    mockContactSegmentAdd.mockResolvedValue({ error: null })
    mockContactSegmentRemove.mockResolvedValue({ error: null })

    // Mock successful Azure response
    mockAzurePollUntilDone.mockResolvedValue({
      status: 'Succeeded',
      id: 'azure-email-id',
    })

    mockAzureBeginSend.mockReturnValue({
      pollUntilDone: mockAzurePollUntilDone,
    })
  })

  describe('sendEmail', () => {
    it('should send a transactional email successfully', async () => {
      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Resend')

      // Should not check unsubscribe status for transactional emails
      expect(isUnsubscribed).not.toHaveBeenCalled()

      // Should call Resend with correct parameters
      expect(mockSend).toHaveBeenCalledWith({
        from: 'TradingGoose <noreply@tradinggoose.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: testEmailOptions.html,
        headers: undefined, // No unsubscribe headers for transactional
      })
    })

    it('should send a marketing email with unsubscribe headers', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
        userId: recipient.id,
        html: async (url) => `<a href="${url}">Unsubscribe</a>`,
      })

      expect(result.success).toBe(true)

      // Should check unsubscribe status
      expect(isUnsubscribed).toHaveBeenCalledWith(recipient.preferences, 'marketing')

      // Should generate unsubscribe token
      expect(generateUnsubscribeToken).toHaveBeenCalledWith(
        { id: recipient.id, email: recipient.email },
        'marketing'
      )

      // Should call Resend with unsubscribe headers
      expect(mockSend).toHaveBeenCalledWith({
        from: 'TradingGoose <noreply@tradinggoose.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: '<a href="https://test.tradinggoose.ai/en/unsubscribe?token=mock-token-123&email=test%40example.com">Unsubscribe</a>',
        headers: {
          'List-Unsubscribe':
            '<https://test.tradinggoose.ai/api/users/me/settings/unsubscribe?token=mock-token-123&email=test%40example.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    })

    it('should skip sending if user has unsubscribed', async () => {
      vi.mocked(isUnsubscribed).mockReturnValue(true)

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
        userId: recipient.id,
        html: async (url) => `<a href="${url}">Unsubscribe</a>`,
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email skipped (user unsubscribed)')

      // Should not call Resend
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('checks the intended account’s current address after rendering a billing notification', async () => {
      const result = await sendEmail({
        ...testEmailOptions,
        userId: recipient.id,
        emailType: 'notifications',
        html: async () => {
          vi.mocked(getEmailRecipient).mockResolvedValueOnce({
            ...recipient,
            email: 'new@example.com',
          })
          return '<p>Usage details</p>'
        },
      })

      expect(result).toMatchObject({ success: false, currentEmail: 'new@example.com' })
      expect(getEmailRecipient).toHaveBeenCalledExactlyOnceWith(eq(user.id, recipient.id))
      expect(mockSend).not.toHaveBeenCalled()
      expect(mockAzureBeginSend).not.toHaveBeenCalled()
    })

    it('reports unavailable delivery without logging the verification code', async () => {
      mockResolveResendServiceConfig.mockResolvedValue({
        apiKey: null,
        audienceId: null,
      })
      mockResolveAzureCommunicationEmailServiceConfig.mockResolvedValue({
        connectionString: null,
      })

      const result = await sendEmail({
        ...testEmailOptions,
        text: 'Verification code: 123456',
        emailType: 'transactional',
      })

      expect(result).toEqual({
        success: false,
        message: 'No email service configured',
      })
      expect(mockSend).not.toHaveBeenCalled()
      expect(mockAzureBeginSend).not.toHaveBeenCalled()
      expect(mockLoggerInfo).not.toHaveBeenCalled()
      expect(mockLoggerWarn).not.toHaveBeenCalled()
      expect(mockLoggerError).not.toHaveBeenCalled()
    })

    it('reports a configured Resend rejection when Azure is unavailable', async () => {
      mockResolveAzureCommunicationEmailServiceConfig.mockResolvedValue({ connectionString: null })
      mockSend.mockResolvedValue({ data: null, error: { message: 'Resend rejected the message' } })

      await expect(sendEmail(testEmailOptions)).resolves.toEqual({
        success: false,
        message: 'Failed to send email',
      })
      expect(mockAzureBeginSend).not.toHaveBeenCalled()
      expect(mockLoggerInfo).not.toHaveBeenCalled()
    })

    it.concurrent('should use custom from address when provided', async () => {
      await sendEmail({
        ...testEmailOptions,
        from: 'custom@example.com',
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'custom@example.com',
        })
      )
    })
  })

  describe('syncUserEmailAudience', () => {
    const old = 'old@example.com'
    const segmentId = 'audience-123'
    const mockTransferRecipients = (current = recipient, formerOwner?: typeof recipient) =>
      vi
        .mocked(getEmailRecipient)
        .mockImplementation(async (where) =>
          isDeepStrictEqual(where, eq(user.id, recipient.id)) ? current : formerOwner
        )

    it('does nothing when the Resend audience is not configured', async () => {
      mockResolveResendServiceConfig.mockResolvedValue({ apiKey: 'test-api-key', audienceId: null })
      await syncUserEmailAudience(recipient)
      expect(mockContactsGet).not.toHaveBeenCalled()
    })

    it('does not enroll an unverified address', async () => {
      vi.mocked(getEmailRecipient).mockResolvedValue({ ...recipient, emailVerified: false })
      await syncUserEmailAudience(recipient)
      expect(mockContactsGet).not.toHaveBeenCalled()
    })

    it('moves a verified address between Studio segment memberships', async () => {
      mockTransferRecipients({ ...recipient, email: ' Test@Example.com ' })
      mockContactsGet.mockResolvedValueOnce({ data: { id: old, unsubscribed: false }, error: null })

      await syncUserEmailAudience(recipient, old)
      expect(mockContactSegmentRemove).toHaveBeenCalledExactlyOnceWith({ email: old, segmentId })
      expect(mockContactsCreate).toHaveBeenCalledExactlyOnceWith({
        email: recipient.email,
        segments: [{ id: segmentId }],
      })
    })

    it('preserves a global opt-out on the destination contact', async () => {
      mockContactsGet.mockResolvedValueOnce({
        data: { id: 'existing', unsubscribed: true },
        error: null,
      })
      await syncUserEmailAudience(recipient)
      expect(mockContactSegmentAdd).not.toHaveBeenCalled()
      expect(mockContactsCreate).not.toHaveBeenCalled()
    })

    it('honors a Studio marketing opt-out by removing only the Studio segment', async () => {
      vi.mocked(isUnsubscribed).mockReturnValue(true)
      await syncUserEmailAudience(recipient)
      expect(mockContactSegmentRemove).toHaveBeenCalledExactlyOnceWith({
        email: recipient.email,
        segmentId,
      })
      expect(mockContactsCreate).not.toHaveBeenCalled()
      expect(mockContactSegmentAdd).not.toHaveBeenCalled()
    })

    it('keeps a previous Resend opt-out for the Studio account', async () => {
      mockTransferRecipients()
      mockContactsGet.mockResolvedValueOnce({ data: { id: old, unsubscribed: true }, error: null })

      await syncUserEmailAudience(recipient, old)
      expect(unsubscribeFromList).toHaveBeenCalledWith(expect.anything(), recipient.id, 'marketing')
      expect(mockContactSegmentRemove).toHaveBeenCalledWith({ email: old, segmentId })
      expect(mockContactSegmentRemove).toHaveBeenCalledWith({ email: recipient.email, segmentId })
      expect(mockContactsCreate).not.toHaveBeenCalled()
    })

    it('leaves a reassigned address with its current verified owner', async () => {
      mockTransferRecipients(recipient, { ...recipient, id: 'other', email: old })
      await syncUserEmailAudience(recipient, old)
      expect(mockContactsGet).toHaveBeenCalledExactlyOnceWith({ email: recipient.email })
      expect(mockContactSegmentRemove).not.toHaveBeenCalled()
      expect(unsubscribeFromList).not.toHaveBeenCalled()
    })

    it('logs contact enrollment failures without failing verification', async () => {
      const error = { message: 'Invalid API key', name: 'invalid_api_key', statusCode: 401 }
      mockContactsCreate.mockResolvedValueOnce({ data: null, error })
      await expect(syncUserEmailAudience(recipient)).resolves.toBe(false)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Failed to synchronize verified user email with Resend',
        { userId: recipient.id, error }
      )
    })

    it.each(['cleanup', 'enrollment'])('retries only the failed %s on transfer', async (step) => {
      mockTransferRecipients()
      const failed = step === 'cleanup' ? mockContactSegmentRemove : mockContactsCreate
      failed.mockResolvedValueOnce({ error: { name: 'internal_server_error', statusCode: 503 } })
      await expect(syncUserEmailAudience(recipient, old)).resolves.toBe(true)
      expect(mockContactSegmentRemove).toHaveBeenCalledTimes(step === 'cleanup' ? 2 : 1)
      expect(mockContactsCreate).toHaveBeenCalledTimes(step === 'enrollment' ? 2 : 1)
    })

    it('enrolls the current mailbox even when the prior removal fails', async () => {
      mockTransferRecipients()
      mockContactSegmentRemove.mockResolvedValue({ error: { statusCode: 403 } })
      await expect(syncUserEmailAudience(recipient, old)).resolves.toBe(false)
      expect(mockContactsCreate).toHaveBeenCalledExactlyOnceWith({
        email: recipient.email,
        segments: [{ id: segmentId }],
      })
    })
  })

  describe('Azure Communication Services fallback', () => {
    it.each(['returned', 'thrown'])(
      'falls back to Azure when Resend %s an error',
      async (failure) => {
        if (failure === 'returned') {
          mockSend.mockResolvedValue({
            data: null,
            error: { message: 'Resend API limit exceeded' },
          })
        } else {
          mockSend.mockRejectedValue(new Error('Network error'))
        }

        const result = await sendEmail({
          ...testEmailOptions,
          emailType: 'updates',
          userId: recipient.id,
          locale: 'es',
          html: async (url) => `<a href="${url}">Cancelar suscripción</a>`,
          text: 'Actualización',
          attachments: [{ filename: 'update.txt', content: 'aG9sYQ==', contentType: 'text/plain' }],
          replyTo: 'support@example.com',
        })

        expect(result.message).toBe('Email sent successfully via Azure Communication Services')
        expect(mockSend).toHaveBeenCalledOnce()
        const url =
          'https://test.tradinggoose.ai/es/unsubscribe?token=mock-token-123&email=test%40example.com'
        expect(mockAzureBeginSend).toHaveBeenCalledWith({
          senderAddress: 'noreply@tradinggoose.ai',
          content: {
            subject: testEmailOptions.subject,
            html: `<a href="${url}">Cancelar suscripción</a>`,
            plainText: `Actualización\n\nCancelar suscripción: ${url}`,
          },
          recipients: { to: [{ address: testEmailOptions.to }] },
          attachments: [
            { name: 'update.txt', contentInBase64: 'aG9sYQ==', contentType: 'text/plain' },
          ],
          replyTo: [{ address: 'support@example.com' }],
          headers: mockSend.mock.calls[0][0].headers,
        })
      }
    )

    it('should handle Azure Communication Services failure', async () => {
      // Mock both services to fail
      mockSend.mockRejectedValue(new Error('Resend service unavailable'))
      mockAzurePollUntilDone.mockResolvedValue({
        status: 'Failed',
        id: 'failed-id',
      })

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(false)
      expect(result.message).toBe('Both Resend and Azure Communication Services failed')

      // Should have tried both services
      expect(mockSend).toHaveBeenCalled()
      expect(mockAzureBeginSend).toHaveBeenCalled()
    })
  })

  describe('sendBatchEmails', () => {
    const testBatchEmails = [
      { ...testEmailOptions, to: 'user1@example.com' },
      { ...testEmailOptions, to: 'user2@example.com' },
    ]

    it('should send batch emails via Resend successfully', async () => {
      const result = await sendBatchEmails(testBatchEmails)

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully via Resend')
      expect(mockBatchSend).toHaveBeenCalled()
    })

    it('should fallback to individual sends when Resend batch fails', async () => {
      // Mock Resend batch to fail
      mockBatchSend.mockRejectedValue(new Error('Batch service unavailable'))

      const result = await sendBatchEmails(testBatchEmails)

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully')

      // Should have tried Resend batch first
      expect(mockBatchSend).toHaveBeenCalled()

      // Should have fallen back to individual sends (which will use Resend since it's available)
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    it('should handle mixed success/failure in individual fallback', async () => {
      // Mock Resend batch to fail
      mockBatchSend.mockRejectedValue(new Error('Batch service unavailable'))

      // Mock first individual send to succeed, second to fail and Azure also fails
      mockSend
        .mockResolvedValueOnce({
          data: { id: 'email-1' },
          error: null,
        })
        .mockRejectedValueOnce(new Error('Individual send failure'))

      // Mock Azure to fail for the second email (first call succeeds, but second fails)
      mockAzurePollUntilDone.mockResolvedValue({
        status: 'Failed',
        id: 'failed-id',
      })

      const result = await sendBatchEmails(testBatchEmails)

      expect(result.success).toBe(false)
      expect(result.message).toBe('1/2 emails sent successfully')
    })
  })
})
