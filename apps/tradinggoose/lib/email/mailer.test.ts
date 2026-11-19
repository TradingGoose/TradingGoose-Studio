import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

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
  getEmailRecipient: vi.fn(),
  generateUnsubscribeToken: vi.fn(),
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

import {
  addVerifiedUserEmailToAudience,
  type EmailType,
  sendBatchEmails,
  sendEmail,
} from '@/lib/email/mailer'
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
  }

  const recipient = {
    id: 'user-123',
    email: testEmailOptions.to,
    emailVerified: true,
    preferences: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(isUnsubscribed as Mock).mockResolvedValue(false)
    ;(generateUnsubscribeToken as Mock).mockReturnValue('mock-token-123')
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
      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Resend')
      expect(result.data).toEqual({ id: 'test-email-id' })

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
      const htmlWithToken = '<p>Test content</p><a href="{{UNSUBSCRIBE_TOKEN}}">Unsubscribe</a>'

      const result = await sendEmail({
        ...testEmailOptions,
        html: htmlWithToken,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)

      // Should check unsubscribe status
      expect(isUnsubscribed).toHaveBeenCalledWith(testEmailOptions.to, 'marketing')

      // Should generate unsubscribe token
      expect(generateUnsubscribeToken).toHaveBeenCalledWith(testEmailOptions.to, 'marketing')

      // Should call Resend with unsubscribe headers
      expect(mockSend).toHaveBeenCalledWith({
        from: 'TradingGoose <noreply@tradinggoose.ai>',
        to: testEmailOptions.to,
        subject: testEmailOptions.subject,
        html: '<p>Test content</p><a href="mock-token-123">Unsubscribe</a>',
        headers: {
          'List-Unsubscribe':
            '<https://test.tradinggoose.ai/en/unsubscribe?token=mock-token-123&email=test%40example.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
    })

    it('should skip sending if user has unsubscribed', async () => {
      ;(isUnsubscribed as Mock).mockResolvedValue(true)

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email skipped (user unsubscribed)')
      expect(result.data).toEqual({ id: 'skipped-unsubscribed' })

      // Should not call Resend
      expect(mockSend).not.toHaveBeenCalled()
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

    it.concurrent('should handle Resend API errors and fallback to Azure', async () => {
      // Mock Resend to fail
      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'API rate limit exceeded' },
      })

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

      // Should have tried Resend first
      expect(mockSend).toHaveBeenCalled()

      // Should have fallen back to Azure
      expect(mockAzureBeginSend).toHaveBeenCalled()
    })

    it.concurrent('should handle unexpected errors and fallback to Azure', async () => {
      // Mock Resend to throw an error
      mockSend.mockRejectedValue(new Error('Network error'))

      const result = await sendEmail(testEmailOptions)

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

      // Should have tried Resend first
      expect(mockSend).toHaveBeenCalled()

      // Should have fallen back to Azure
      expect(mockAzureBeginSend).toHaveBeenCalled()
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

    it('should not include unsubscribe when includeUnsubscribe is false', async () => {
      await sendEmail({
        ...testEmailOptions,
        emailType: 'marketing',
        includeUnsubscribe: false,
      })

      expect(generateUnsubscribeToken).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: undefined,
        })
      )
    })

    it.concurrent('should replace unsubscribe token placeholders in HTML', async () => {
      const htmlWithPlaceholder = '<p>Content</p><a href="{{UNSUBSCRIBE_TOKEN}}">Unsubscribe</a>'

      await sendEmail({
        ...testEmailOptions,
        html: htmlWithPlaceholder,
        emailType: 'updates' as EmailType,
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<p>Content</p><a href="mock-token-123">Unsubscribe</a>',
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

      await addVerifiedUserEmailToAudience(verifiedUser)

      expect(mockContactsGet).not.toHaveBeenCalled()
    })

    it('does not enroll an unverified address', async () => {
      vi.mocked(getEmailRecipient).mockResolvedValue({ ...verifiedUser, emailVerified: false })

      await addVerifiedUserEmailToAudience(verifiedUser)

      expect(mockContactsGet).not.toHaveBeenCalled()
    })

    it.each([false, true])(
      'enrolls the normalized verified address with marketing opt-out %s',
      async (unsubscribed) => {
        vi.mocked(getEmailRecipient).mockResolvedValue({
          ...verifiedUser,
          preferences: { unsubscribeMarketing: unsubscribed },
        })

        await addVerifiedUserEmailToAudience(verifiedUser)

        expect(mockContactsCreate).toHaveBeenCalledExactlyOnceWith({
          email: 'user@example.com',
          unsubscribed,
          segments: [{ id: 'audience-123' }],
        })
      }
    )

    it.each([
      [true, false],
      [false, true],
    ])('preserves opt-outs for an existing contact (%s, %s)', async (appOptOut, existingOptOut) => {
      vi.mocked(getEmailRecipient).mockResolvedValue({
        ...verifiedUser,
        preferences: { unsubscribeMarketing: appOptOut },
      })
      mockContactsGet.mockResolvedValueOnce({
        data: { id: 'existing-contact', unsubscribed: existingOptOut },
        error: null,
      })

      await addVerifiedUserEmailToAudience(verifiedUser)

      expect(mockContactsCreate).not.toHaveBeenCalled()
      if (appOptOut) {
        expect(mockContactsUpdate).toHaveBeenCalledExactlyOnceWith({
          id: 'existing-contact',
          unsubscribed: true,
        })
      } else {
        expect(mockContactsUpdate).not.toHaveBeenCalled()
      }
      expect(mockContactSegmentAdd).toHaveBeenCalledExactlyOnceWith({
        contactId: 'existing-contact',
        segmentId: 'audience-123',
      })
    })

    it('carries the previous contact’s Resend opt-out and removes only its Studio segment', async () => {
      vi.mocked(getEmailRecipient).mockResolvedValueOnce(verifiedUser).mockResolvedValue(undefined)
      mockContactsGet.mockResolvedValueOnce({
        data: { id: 'old', email: 'old@example.com', unsubscribed: true },
        error: null,
      })

      await addVerifiedUserEmailToAudience(verifiedUser, 'old@example.com')

      expect(mockContactsCreate).toHaveBeenCalledWith({
        email: 'user@example.com',
        unsubscribed: true,
        segments: [{ id: 'audience-123' }],
      })
      expect(mockContactSegmentRemove).toHaveBeenCalledWith({
        contactId: 'old',
        segmentId: 'audience-123',
      })
    })

    it('leaves a reassigned verified address and its preferences with its new owner', async () => {
      vi.mocked(getEmailRecipient)
        .mockResolvedValueOnce(verifiedUser)
        .mockResolvedValueOnce({ ...recipient, id: 'other' })
        .mockResolvedValue(verifiedUser)
      await addVerifiedUserEmailToAudience(verifiedUser, 'old@example.com')

      expect(mockContactsGet).toHaveBeenCalledExactlyOnceWith({ email: 'user@example.com' })
      expect(mockContactSegmentRemove).not.toHaveBeenCalled()
    })

    it('moves a late enrollment and its Resend opt-out to the latest verified address', async () => {
      const old = 'old@example.com'
      const intermediate = 'intermediate@example.com'
      const latest = 'latest@example.com'
      const contacts = new Map([[old, true]])
      const members = new Set([old])
      const dialect = new PgDialect()
      let email = intermediate
      vi.mocked(getEmailRecipient).mockImplementation(async (where) => {
        const [key] = dialect.sqlToQuery(where).params
        return key === recipient.id || key === email ? { ...recipient, email } : undefined
      })
      let finishEnrollment!: () => void
      const enrollment = new Promise<void>((resolve) => {
        finishEnrollment = resolve
      })
      mockContactsGet.mockImplementation(async ({ email }) => ({
        data: contacts.has(email) ? { id: email, email, unsubscribed: contacts.get(email) } : null,
        error: null,
      }))
      mockContactsCreate.mockImplementation(async ({ email, unsubscribed }) => {
        if (email === intermediate) await enrollment
        contacts.set(email, unsubscribed)
        members.add(email)
        return { error: null }
      })
      mockContactsUpdate.mockImplementation(async ({ id, unsubscribed }) => {
        contacts.set(id, unsubscribed)
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

      const firstSync = addVerifiedUserEmailToAudience(recipient, old)
      await vi.waitFor(() => expect(mockContactsCreate).toHaveBeenCalledOnce())
      email = latest
      await addVerifiedUserEmailToAudience(recipient, intermediate)
      finishEnrollment()
      await firstSync

      expect([...members]).toEqual([latest])
      expect(contacts.get(latest)).toBe(true)
      expect(mockLoggerWarn).not.toHaveBeenCalled()
    })

    it('logs contact enrollment failures without failing verification', async () => {
      const error = { message: 'Invalid API key', name: 'invalid_api_key', statusCode: 401 }
      mockContactsCreate.mockResolvedValueOnce({ data: null, error })

      await expect(addVerifiedUserEmailToAudience(verifiedUser)).resolves.toBeUndefined()
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Failed to synchronize verified user email with Resend',
        { userId: verifiedUser.id, error }
      )
    })
  })

  describe('Azure Communication Services fallback', () => {
    it('should fallback to Azure when Resend fails', async () => {
      // Mock Resend to fail
      mockSend.mockRejectedValue(new Error('Resend service unavailable'))

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Email sent successfully via Azure Communication Services')
      expect(result.data).toEqual({ id: 'azure-email-id' })

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
    })

    it('should handle Azure Communication Services failure', async () => {
      // Mock both services to fail
      mockSend.mockRejectedValue(new Error('Resend service unavailable'))
      mockAzurePollUntilDone.mockResolvedValue({
        status: 'Failed',
        id: 'failed-id',
      })

      const result = await sendEmail({
        ...testEmailOptions,
        emailType: 'transactional',
      })

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
      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully via Resend')
      expect(result.results).toHaveLength(2)
      expect(mockBatchSend).toHaveBeenCalled()
    })

    it('should fallback to individual sends when Resend batch fails', async () => {
      // Mock Resend batch to fail
      mockBatchSend.mockRejectedValue(new Error('Batch service unavailable'))

      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(true)
      expect(result.message).toBe('All batch emails sent successfully')
      expect(result.results).toHaveLength(2)

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

      const result = await sendBatchEmails({ emails: testBatchEmails })

      expect(result.success).toBe(false)
      expect(result.message).toBe('1/2 emails sent successfully')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].success).toBe(true)
      expect(result.results[1].success).toBe(false)
    })
  })
})
