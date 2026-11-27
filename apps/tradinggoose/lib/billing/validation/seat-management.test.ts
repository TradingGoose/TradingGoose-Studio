/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationTransaction } from '@/lib/organization/admission'

describe('validateSeatAvailability', () => {
  const selectMock = vi.fn()
  const updateMock = vi.fn()
  const getOrganizationSubscriptionMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    selectMock.mockReset()
    updateMock.mockReset()
    getOrganizationSubscriptionMock.mockReset()

    vi.doMock('@tradinggoose/db', () => ({
      db: {
        select: selectMock,
        update: updateMock,
      },
    }))

    vi.doMock('@tradinggoose/db/schema', () => ({
      invitation: {},
      member: {
        organizationId: 'member.organizationId',
      },
      organization: {},
      subscription: {},
      user: {},
      userStats: {},
    }))

    vi.doMock('@/lib/billing/core/billing', () => ({
      getOrganizationSubscription: getOrganizationSubscriptionMock,
    }))

    vi.doMock('@/lib/email/validation', () => ({
      quickValidateEmail: vi.fn(),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      })),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invites when the organization has no active subscription', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue(null)

    const { validateSeatAvailability } = await import('./seat-management')

    await expect(validateSeatAvailability('org-1')).resolves.toEqual({
      canInvite: false,
      reason: 'No active subscription found',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    })
    expect(selectMock).not.toHaveBeenCalled()
  })

  it.each([
    ['single', ['guest@example.com'], 1, 1],
    ['batch', ['guest@example.com', 'GUEST@example.com'], 1, 1],
    ['last seat already occupied', ['guest@example.com'], 2, 0],
  ] as const)(
    'reserves the available seat once for %s',
    async (_name, emails, members, expected) => {
      const { quickValidateEmail } = await import('@/lib/email/validation')
      const actual =
        await vi.importActual<typeof import('@/lib/email/validation')>('@/lib/email/validation')
      vi.mocked(quickValidateEmail).mockImplementation(actual.quickValidateEmail)
      getOrganizationSubscriptionMock.mockResolvedValue({
        seats: 2,
        tier: { ownerType: 'organization', seatCount: 2 },
      })
      const where = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: members }])
        .mockResolvedValueOnce([{ count: 0 }])
      const reads = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where }
      const values = vi.fn()
      const tx = {
        select: () => reads,
        insert: () => ({ values }),
      } as unknown as OrganizationTransaction
      const { reserveOrganizationInvitations } = await import('./seat-management')
      const result = await reserveOrganizationInvitations(tx, {
        organizationId: 'org',
        inviterId: 'owner',
        emails: [...emails],
        role: 'member',
      })
      expect(result.invitations).toHaveLength(expected)
      expect(values).toHaveBeenCalledTimes(expected)
      if (expected)
        expect(values).toHaveBeenCalledWith([
          expect.objectContaining({ email: 'guest@example.com', status: 'pending' }),
        ])
    }
  )

  it('counts pending invitations against the available seat total', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue({
      seats: 3,
      tier: {
        ownerType: 'organization',
        seatCount: 3,
      },
    })

    const memberCountChain: any = {
      from: vi.fn(() => memberCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 1 }])),
    }
    const invitationCountChain: any = {
      from: vi.fn(() => invitationCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 2 }])),
    }
    selectMock.mockReturnValueOnce(memberCountChain).mockReturnValueOnce(invitationCountChain)

    const { validateSeatAvailability } = await import('./seat-management')

    await expect(validateSeatAvailability('org-1')).resolves.toEqual({
      canInvite: false,
      reason: 'No available seats. Currently using 3 of 3 seats.',
      currentSeats: 3,
      maxSeats: 3,
      availableSeats: 0,
    })
  })

  it('prevents reducing seats below the occupied seat count', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue({
      id: 'sub-1',
      seats: 3,
      tier: {
        ownerType: 'organization',
        seatMode: 'adjustable',
        seatCount: 1,
      },
    })

    const memberCountChain: any = {
      from: vi.fn(() => memberCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 1 }])),
    }
    const invitationCountChain: any = {
      from: vi.fn(() => invitationCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 2 }])),
    }
    selectMock.mockReturnValueOnce(memberCountChain).mockReturnValueOnce(invitationCountChain)

    const { updateOrganizationSeats } = await import('./seat-management')

    await expect(updateOrganizationSeats('org-1', 2, 'user-1')).resolves.toEqual({
      success: false,
      error: 'Cannot reduce seats below current occupied seat count (3)',
    })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('reports pending invitations in organization seat info', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue({
      seats: 4,
      tier: {
        ownerType: 'organization',
        seatCount: 4,
        displayName: 'Team',
        seatMode: 'adjustable',
      },
    })

    const organizationChain: any = {
      from: vi.fn(() => organizationChain),
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([{ id: 'org-1', name: 'TradingGoose' }])),
      })),
    }
    const memberCountChain: any = {
      from: vi.fn(() => memberCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 1 }])),
    }
    const invitationCountChain: any = {
      from: vi.fn(() => invitationCountChain),
      where: vi.fn(() => Promise.resolve([{ count: 2 }])),
    }
    selectMock
      .mockReturnValueOnce(organizationChain)
      .mockReturnValueOnce(memberCountChain)
      .mockReturnValueOnce(invitationCountChain)

    const { getOrganizationSeatInfo } = await import('./seat-management')

    await expect(getOrganizationSeatInfo('org-1')).resolves.toEqual({
      organizationId: 'org-1',
      organizationName: 'TradingGoose',
      currentSeats: 3,
      memberSeats: 1,
      pendingInvitations: 2,
      maxSeats: 4,
      availableSeats: 1,
      subscriptionTierName: 'Team',
      canAddSeats: true,
    })
  })
})
