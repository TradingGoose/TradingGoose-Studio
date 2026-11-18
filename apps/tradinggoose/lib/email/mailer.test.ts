import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()
const mockBatchSend = vi.fn()
const mockContactsCreate = vi.fn()
const mockContactsGet = vi.fn()
const mockContactsUpdate = vi.fn()
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
          update: (...args: any[]) => mockContactsUpdate(...args),
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
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}))

import { addVerifiedUserEmailToAudience, sendBatchEmails, sendEmail } from '@/lib/email/mailer'
import {
  generateUnsubscribeToken,
  getEmailRecipient,
  isUnsubscribed,
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
    mailboxVersion: 0,
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
    mockContactsUpdate.mockResolvedValue({ error: null })
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
      })

      expect(result.success).toBe(true)

      // Should check unsubscribe status
      expect(isUnsubscribed).toHaveBeenCalledWith(recipient.preferences, 'marketing')

      // Should generate unsubscribe token
      expect(generateUnsubscribeToken).toHaveBeenCalledWith(recipient, 'marketing')

      // Should call Resend with unsubscribe headers
      expect(mockSend).toHaveBeenCalledWith({
        from: 'TradingGoose <noreply@tradinggoose.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: testEmailOptions.html,
        headers: {
          'List-Unsubscribe':
            '<https://test.tradinggoose.ai/en/unsubscribe?token=mock-token-123&email=test%40example.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    })

    it('should skip sending if user has unsubscribed', async () => {
      vi.mocked(isUnsubscribed).mockReturnValue(true)

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email skipped (user unsubscribed)')

      // Should not call Resend
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should log unsent email text when no email service is configured', async () => {
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
        success: true,
        message: 'Email logging successful (no email service configured)',
      })
      expect(mockSend).not.toHaveBeenCalled()
      expect(mockAzureBeginSend).not.toHaveBeenCalled()
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Email not sent (no email service configured):',
        expect.objectContaining({
          to: testEmailOptions.to,
          subject: testEmailOptions.subject,
          from: 'TradingGoose <noreply@tradinggoose.ai>',
          text: 'Verification code: 123456',
        })
      )
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

  describe('addVerifiedUserEmailToAudience', () => {
    const verifiedUser = { ...recipient, email: ' User@Example.com ' }

    beforeEach(() => {
      vi.mocked(getEmailRecipient).mockResolvedValue(verifiedUser)
    })

    it('does nothing when the Resend audience is not configured', async () => {
      mockResolveResendServiceConfig.mockResolvedValue({
        apiKey: 'test-api-key',
        audienceId: null,
      })

      await addVerifiedUserEmailToAudience({
        id: 'user-123',
        email: 'User@example.com',
      })

      expect(mockContactsCreate).not.toHaveBeenCalled()
    })

    it('adds a normalized verified email to the configured audience', async () => {
      await addVerifiedUserEmailToAudience(verifiedUser)

      expect(mockContactsCreate).toHaveBeenCalledWith({
        email: 'user@example.com',
        unsubscribed: false,
        segments: [{ id: 'audience-123' }],
      })
    })

    it.each([
      [false, false],
      [true, false],
      [false, true],
    ])('moves the mailbox and carries either opt-out (%s, %s)', async (appOptOut, resendOptOut) => {
      vi.mocked(isUnsubscribed).mockReturnValue(appOptOut)
      mockContactsGet.mockResolvedValueOnce({
        data: { id: 'old-contact', unsubscribed: resendOptOut },
        error: null,
      })

      await addVerifiedUserEmailToAudience(verifiedUser, ' Old@Example.com ')

      expect(mockContactsGet).toHaveBeenNthCalledWith(1, { email: 'old@example.com' })
      expect(mockContactSegmentRemove).toHaveBeenCalledExactlyOnceWith({
        contactId: 'old-contact',
        segmentId: 'audience-123',
      })
      expect(mockContactsCreate).toHaveBeenCalledExactlyOnceWith({
        email: 'user@example.com',
        unsubscribed: appOptOut || resendOptOut,
        segments: [{ id: 'audience-123' }],
      })
      expect(mockContactsCreate.mock.invocationCallOrder[0]).toBeLessThan(
        mockContactSegmentRemove.mock.invocationCallOrder[0]
      )
    })

    it.each([
      [true, false],
      [false, true],
    ])(
      'preserves opt-outs when the new contact already exists (%s, %s)',
      async (appOptOut, existingOptOut) => {
        vi.mocked(isUnsubscribed).mockReturnValue(appOptOut)
        mockContactsGet.mockResolvedValueOnce({
          data: { id: 'new-contact', unsubscribed: existingOptOut },
          error: null,
        })

        await addVerifiedUserEmailToAudience(verifiedUser)

        expect(mockContactsCreate).not.toHaveBeenCalled()
        if (appOptOut) {
          expect(mockContactsUpdate).toHaveBeenCalledExactlyOnceWith({
            id: 'new-contact',
            unsubscribed: true,
          })
        } else {
          expect(mockContactsUpdate).not.toHaveBeenCalled()
        }
        expect(mockContactSegmentAdd).toHaveBeenCalledExactlyOnceWith({
          contactId: 'new-contact',
          segmentId: 'audience-123',
        })
      }
    )

    it('keeps the previous membership when Resend rejects destination enrollment', async () => {
      mockContactsGet.mockResolvedValueOnce({
        data: { id: 'old-contact', unsubscribed: false },
        error: null,
      })
      mockContactsCreate.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid API key',
          name: 'invalid_api_key',
          statusCode: 401,
        },
        headers: null,
      })

      await expect(
        addVerifiedUserEmailToAudience(verifiedUser, 'old@example.com')
      ).resolves.toBeUndefined()
      expect(mockContactsCreate).toHaveBeenCalledOnce()
      expect(mockContactSegmentRemove).not.toHaveBeenCalled()
    })

    it('honors Retry-After and resumes a partially completed mailbox move', async () => {
      vi.useFakeTimers()
      try {
        let enrolled = false
        mockContactsGet.mockImplementation(async ({ email }) => {
          if (email === 'old@example.com') {
            return { data: { id: 'old-contact', unsubscribed: true }, error: null }
          }
          return enrolled
            ? { data: { id: 'new-contact', unsubscribed: true }, error: null }
            : { data: null, error: { statusCode: 404 } }
        })
        mockContactsCreate
          .mockResolvedValueOnce({ error: { statusCode: 429 }, headers: { 'retry-after': '2' } })
          .mockImplementationOnce(async () => {
            enrolled = true
            return { error: null }
          })
        mockContactSegmentRemove
          .mockResolvedValueOnce({ error: { statusCode: 503 } })
          .mockResolvedValueOnce({ error: { statusCode: 404 } })

        const sync = addVerifiedUserEmailToAudience(verifiedUser, 'old@example.com')
        await vi.advanceTimersByTimeAsync(1999)
        expect(mockContactsCreate).toHaveBeenCalledOnce()
        expect(mockContactSegmentRemove).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(mockContactsCreate).toHaveBeenCalledTimes(2)
        expect(mockContactSegmentRemove).toHaveBeenCalledOnce()
        await vi.runAllTimersAsync()
        await sync

        expect(mockContactsCreate).toHaveBeenCalledTimes(2)
        expect(mockContactsCreate).toHaveBeenLastCalledWith(
          expect.objectContaining({ unsubscribed: true })
        )
        expect(mockContactsUpdate).not.toHaveBeenCalled()
        expect(mockContactSegmentAdd).toHaveBeenCalledExactlyOnceWith({
          contactId: 'new-contact',
          segmentId: 'audience-123',
        })
        expect(mockContactSegmentRemove).toHaveBeenCalledTimes(2)
        expect(mockLoggerWarn).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('removes an intermediate mailbox enrolled after the latest change synced', async () => {
      const first = { ...recipient, email: 'first@example.com', mailboxVersion: 1 }
      const latest = { ...recipient, email: 'latest@example.com', mailboxVersion: 2 }
      const previousEmail = 'previous@example.com'
      const contacts = new Set([previousEmail])
      const members = new Set(contacts)
      let finishEnrollment!: () => void
      const enrollment = new Promise<void>((resolve) => {
        finishEnrollment = resolve
      })
      mockContactsGet.mockImplementation(async ({ email }) =>
        contacts.has(email)
          ? { data: { id: email, unsubscribed: false }, error: null }
          : { data: null, error: { statusCode: 404 } }
      )
      mockContactsCreate.mockImplementation(async ({ email }) => {
        if (email === first.email) await enrollment
        contacts.add(email)
        members.add(email)
        return { error: null }
      })
      mockContactSegmentAdd.mockImplementation(async ({ contactId }) => {
        members.add(contactId)
        return { error: null }
      })
      mockContactSegmentRemove.mockImplementation(async ({ contactId }) => {
        members.delete(contactId)
        return { error: null }
      })

      vi.mocked(getEmailRecipient).mockResolvedValue(first)
      const firstSync = addVerifiedUserEmailToAudience(first, previousEmail)
      await vi.waitFor(() => expect(mockContactsCreate).toHaveBeenCalledOnce())
      vi.mocked(getEmailRecipient).mockResolvedValue(latest)
      await addVerifiedUserEmailToAudience(latest, first.email)
      finishEnrollment()
      await firstSync

      expect([...members]).toEqual([latest.email])
      expect(mockLoggerWarn).not.toHaveBeenCalled()
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

        const result = await sendEmail(testEmailOptions)

        expect(result.success).toBe(true)
        expect(result.message).toBe('Email sent successfully via Azure Communication Services')

        // Should have tried Resend first
        expect(mockSend).toHaveBeenCalled()

        // Should have fallen back to Azure
        expect(mockAzureBeginSend).toHaveBeenCalledWith({
          senderAddress: 'noreply@tradinggoose.ai',
          content: {
            subject: testEmailOptions.subject,
            html: testEmailOptions.html,
          },
          recipients: {
            to: [{ address: testEmailOptions.to }],
          },
          headers: {},
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
