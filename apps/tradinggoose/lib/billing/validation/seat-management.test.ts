/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateSeatAvailability } from './seat-management'

const { selectMock, getOrganizationSubscriptionMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  getOrganizationSubscriptionMock: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: selectMock } }))
vi.mock('@/lib/billing/core/billing', () => ({
  getOrganizationSubscription: getOrganizationSubscriptionMock,
}))

describe('validateSeatAvailability', () => {
  beforeEach(() => vi.resetAllMocks())

  it('rejects invites when the organization has no active subscription', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue(null)

    await expect(validateSeatAvailability('org-1')).resolves.toEqual({
      canInvite: false,
      reason: 'No active subscription found',
      currentSeats: 0,
      maxSeats: 0,
      availableSeats: 0,
    })
    expect(selectMock).not.toHaveBeenCalled()
  })

  it('counts pending invitations against the available seat total', async () => {
    getOrganizationSubscriptionMock.mockResolvedValue({
      seats: 3,
      tier: {
        ownerType: 'organization',
        seatCount: 3,
      },
    })

    for (const count of [1, 2]) {
      selectMock.mockReturnValueOnce({ from: () => ({ where: async () => [{ count }] }) })
    }

    await expect(validateSeatAvailability('org-1')).resolves.toEqual({
      canInvite: false,
      reason: 'No available seats. Currently using 3 of 3 seats.',
      currentSeats: 3,
      maxSeats: 3,
      availableSeats: 0,
    })
  })
})
