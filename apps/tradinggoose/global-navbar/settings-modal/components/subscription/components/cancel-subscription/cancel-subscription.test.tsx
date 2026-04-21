import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseSession = vi.fn()
const mockUseSubscription = vi.fn()
const mockUseOrganizations = vi.fn()
const mockUseSubscriptionData = vi.fn()
const mockUseQueryClient = vi.fn()

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockUseSession(),
  useSubscription: () => mockUseSubscription(),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'https://example.com',
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}))

vi.mock('@/hooks/queries/organization', () => ({
  organizationKeys: {
    detail: vi.fn(),
    billing: vi.fn(),
    lists: vi.fn(),
  },
  useOrganizations: () => mockUseOrganizations(),
}))

vi.mock('@/hooks/queries/subscription', () => ({
  subscriptionKeys: {
    user: () => ['subscription', 'user'],
  },
  useSubscriptionData: () => mockUseSubscriptionData(),
}))

describe('CancelSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: 'user-1',
        },
      },
    })
    mockUseSubscription.mockReturnValue({
      cancel: vi.fn(),
      restore: vi.fn(),
    })
    mockUseOrganizations.mockReturnValue({
      data: {
        activeOrganization: null,
      },
    })
    mockUseSubscriptionData.mockReturnValue({
      data: {
        id: 'sub_123',
        isPaid: false,
        stripeSubscriptionId: 'stripe_sub_123',
        tier: {
          ownerType: 'user',
          monthlyPriceUsd: 0,
          yearlyPriceUsd: 0,
        },
      },
    })
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: vi.fn(),
    })
  })

  it('renders restore actions for scheduled cancellation on an activated $0 PAYG subscription', async () => {
    const { CancelSubscription } = await import('./cancel-subscription')

    const markup = renderToStaticMarkup(
      <CancelSubscription
        subscription={{
          tierDisplayName: 'PAYG',
          canManage: true,
        }}
        subscriptionData={{
          periodEnd: new Date('2026-05-01T00:00:00.000Z'),
          cancelAtPeriodEnd: true,
        }}
      />
    )

    expect(markup).toContain('Restore Subscription')
    expect(markup).not.toContain('>Continue<')
  })

  it('does not render subscription controls when the caller marks the subscription as unmanageable', async () => {
    const { CancelSubscription } = await import('./cancel-subscription')

    const markup = renderToStaticMarkup(
      <CancelSubscription
        subscription={{
          tierDisplayName: 'PAYG',
          canManage: false,
        }}
        subscriptionData={{
          cancelAtPeriodEnd: true,
        }}
      />
    )

    expect(markup).toBe('')
  })
})
