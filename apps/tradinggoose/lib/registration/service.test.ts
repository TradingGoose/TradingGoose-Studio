import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDbSelect,
  mockDbUpdate,
  mockGetBaseUrl,
  mockGetEmailSubject,
  mockLogger,
  mockRenderWaitlistApprovedEmail,
  mockRenderWaitlistConfirmationEmail,
  mockSelectFrom,
  mockSelectWhere,
  mockSendBatchEmails,
  mockSendEmail,
  mockUpdateSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockGetBaseUrl: vi.fn(),
  mockGetEmailSubject: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  mockRenderWaitlistApprovedEmail: vi.fn(),
  mockRenderWaitlistConfirmationEmail: vi.fn(),
  mockSelectFrom: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSendBatchEmails: vi.fn(),
  mockSendEmail: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  invitation: {
    email: 'invitation.email',
    expiresAt: 'invitation.expiresAt',
    status: 'invitation.status',
  },
  waitlist: {
    approvedAt: 'waitlist.approvedAt',
    approvedByUserId: 'waitlist.approvedByUserId',
    createdAt: 'waitlist.createdAt',
    email: 'waitlist.email',
    id: 'waitlist.id',
    rejectedAt: 'waitlist.rejectedAt',
    rejectedByUserId: 'waitlist.rejectedByUserId',
    signedUpAt: 'waitlist.signedUpAt',
    status: 'waitlist.status',
    updatedAt: 'waitlist.updatedAt',
    userId: 'waitlist.userId',
  },
  workspaceInvitation: {
    email: 'workspaceInvitation.email',
    expiresAt: 'workspaceInvitation.expiresAt',
    status: 'workspaceInvitation.status',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ args, kind: 'and' }),
  desc: (...args: unknown[]) => ({ args, kind: 'desc' }),
  eq: (...args: unknown[]) => ({ args, kind: 'eq' }),
  gt: (...args: unknown[]) => ({ args, kind: 'gt' }),
  inArray: (...args: unknown[]) => ({ args, kind: 'inArray' }),
  ne: (...args: unknown[]) => ({ args, kind: 'ne' }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  }),
}))

vi.mock('@/components/emails/render-email', () => ({
  getEmailSubject: (...args: unknown[]) => mockGetEmailSubject(...args),
  renderWaitlistApprovedEmail: (...args: unknown[]) => mockRenderWaitlistApprovedEmail(...args),
  renderWaitlistConfirmationEmail: (...args: unknown[]) =>
    mockRenderWaitlistConfirmationEmail(...args),
}))

vi.mock('@/lib/email/mailer', () => ({
  sendBatchEmails: (...args: unknown[]) => mockSendBatchEmails(...args),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => mockLogger,
}))

vi.mock('@/lib/system-settings/service', () => ({
  getSystemSettingsRecord: vi.fn(),
  resolveSystemSettingsFlags: vi.fn(),
  upsertSystemSettings: vi.fn(),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: (...args: unknown[]) => mockGetBaseUrl(...args),
}))

import { updateWaitlistStatuses } from './service'

describe('registration service waitlist approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDbSelect.mockReturnValue({ from: mockSelectFrom })
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet })
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
    mockUpdateWhere.mockResolvedValue(undefined)

    mockGetBaseUrl.mockReturnValue('https://app.tradinggoose.ai')
    mockGetEmailSubject.mockReturnValue('Your TradingGoose access request was approved')
    mockRenderWaitlistApprovedEmail.mockImplementation(
      async (email: string, signupLink: string) => `<p>${email}:${signupLink}</p>`
    )
    mockSendBatchEmails.mockResolvedValue({
      data: { count: 1 },
      message: 'All batch emails sent successfully via Resend',
      results: [],
      success: true,
    })
  })

  it('sends changed approval emails through the batch mailer', async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { email: 'alpha@example.com', id: 'entry-1', status: 'pending' },
      { email: 'beta@example.com', id: 'entry-2', status: 'rejected' },
    ])

    await updateWaitlistStatuses({
      ids: ['entry-1', 'entry-2'],
      reviewerUserId: 'admin-1',
      status: 'approved',
    })

    expect(mockSendBatchEmails).toHaveBeenCalledTimes(1)
    expect(mockSendBatchEmails).toHaveBeenCalledWith({
      emails: [
        {
          emailType: 'transactional',
          html: '<p>alpha@example.com:https://app.tradinggoose.ai/signup?email=alpha%40example.com</p>',
          subject: 'Your TradingGoose access request was approved',
          to: 'alpha@example.com',
        },
        {
          emailType: 'transactional',
          html: '<p>beta@example.com:https://app.tradinggoose.ai/signup?email=beta%40example.com</p>',
          subject: 'Your TradingGoose access request was approved',
          to: 'beta@example.com',
        },
      ],
    })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('chunks approval email batches to the Resend request limit', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      email: `user-${index}@example.com`,
      id: `entry-${index}`,
      status: 'pending',
    }))

    mockSelectWhere.mockResolvedValueOnce(rows)

    await updateWaitlistStatuses({
      ids: rows.map((row) => row.id),
      reviewerUserId: 'admin-1',
      status: 'approved',
    })

    expect(mockSendBatchEmails).toHaveBeenCalledTimes(2)
    expect(mockSendBatchEmails.mock.calls[0][0].emails).toHaveLength(100)
    expect(mockSendBatchEmails.mock.calls[1][0].emails).toHaveLength(1)
  })

  it('does not send approval emails for rejected status updates', async () => {
    mockSelectWhere.mockResolvedValueOnce([
      { email: 'alpha@example.com', id: 'entry-1', status: 'pending' },
    ])

    await updateWaitlistStatuses({
      ids: ['entry-1'],
      reviewerUserId: 'admin-1',
      status: 'rejected',
    })

    expect(mockSendBatchEmails).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
