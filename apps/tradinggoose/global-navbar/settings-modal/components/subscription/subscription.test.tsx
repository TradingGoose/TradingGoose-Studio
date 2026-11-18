/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import { organizationKeys } from '@/hooks/queries/organization'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { Subscription } from './subscription'

const mocks = vi.hoisted(() => ({
  organizationBilling: null as Record<string, unknown> | null,
  organizationBillingError: false,
  organizationBillingId: '',
  organizationBillingPlaceholder: false,
  handleUpgrade: vi.fn(),
  getFullOrganization: vi.fn(),
  personalBilling: null as Record<string, unknown> | null,
  privateTiers: [] as Array<Record<string, unknown>>,
  privateTierAccessError: null as Error | null,
  publicTiers: [] as Array<Record<string, unknown>>,
  workspaceId: 'workspace-1',
  workspaceSettings: null as Record<string, unknown> | null,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: mocks.workspaceId }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: { id: 'user-1', email: 'user@example.com' },
      session: { activeOrganizationId: 'org-active' },
    },
  }),
  client: { organization: { getFullOrganization: mocks.getFullOrganization } },
}))

vi.mock('@/lib/subscription/upgrade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscription/upgrade')>()),
  useSubscriptionUpgrade: () => ({ handleUpgrade: mocks.handleUpgrade }),
}))

vi.mock('@/hooks/queries/subscription', () => ({
  useSubscriptionData: () => ({
    data: mocks.personalBilling,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUsageLimitData: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
}))

vi.mock('@/hooks/queries/workspace', () => ({
  useWorkspaceSettings: () => ({
    data: mocks.workspaceSettings,
    isLoading: false,
    isError: false,
  }),
  workspaceMutationOptions: { updateSettings: vi.fn() },
}))

vi.mock('@/hooks/queries/organization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/queries/organization')>()),
  useOrganizationBilling: (id: string) => {
    mocks.organizationBillingId = id
    return {
      data: mocks.organizationBilling,
      isLoading: false,
      isError: mocks.organizationBillingError,
      isPlaceholderData: mocks.organizationBillingPlaceholder,
    }
  },
  useOrganizations: () => ({ data: { activeOrganization: null }, isLoading: false }),
  organizationMutationOptions: { assignWorkspace: vi.fn() },
}))

vi.mock('@/hooks/queries/public-billing-catalog', () => ({
  usePublicBillingCatalog: () => ({
    data: {
      publicTiers: mocks.publicTiers,
      enterprisePlaceholder: null,
      enterpriseContactUrl: null,
    },
    isLoading: false,
  }),
}))

vi.mock('@/hooks/queries/private-tier-access', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/queries/private-tier-access')>()
  return {
    ...original,
    usePrivateTierAccessForm: () => ({
      accessCode: '',
      errorCode: mocks.privateTierAccessError
        ? (original.getPrivateTierAccessErrorCode(mocks.privateTierAccessError) ??
          PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed)
        : null,
      mutation: { isPending: false, isSuccess: false },
      onChange: vi.fn(),
      onSubmit: vi.fn(),
      query: {
        data: { privateTiers: mocks.privateTiers },
        isLoading: false,
      },
    }),
  }
})

vi.mock('./components', () => ({
  PlanCard: ({
    name,
    price,
    buttonText,
    onButtonClick,
    buttonDisabled,
  }: {
    name: string
    price: string
    buttonText: string
    onButtonClick: () => void
    buttonDisabled?: boolean
  }) => (
    <button
      type='button'
      data-testid='plan-card'
      data-price={price}
      onClick={onButtonClick}
      disabled={buttonDisabled}
    >
      {`${name}:${buttonText}`}
    </button>
  ),
  UsageLimit: () => <div data-testid='usage-limit' />,
  WorkspaceBillingOwnerEditor: () => <div data-testid='billing-owner-editor' />,
}))

vi.mock('../shared/usage-header', () => ({
  UsageHeader: ({
    title,
    rightContent,
    onBadgeClick,
  }: {
    title: string
    rightContent?: ReactNode
    onBadgeClick?: () => void
  }) => (
    <div>
      <h1>{title}</h1>
      {rightContent}
      <button type='button' data-testid='usage-badge' onClick={onBadgeClick}>
        Badge
      </button>
    </div>
  ),
}))

vi.mock('@/stores/settings/general/store', () => ({
  useGeneralStore: () => false,
}))

function tier(
  id: string,
  displayName: string,
  ownerType: 'user' | 'organization',
  overrides: Record<string, unknown> = {}
) {
  return {
    ...EMPTY_BILLING_TIER_SUMMARY,
    id,
    displayName,
    status: 'active',
    ownerType,
    isPublic: true,
    hasStripeMonthlyPriceId: true,
    ...overrides,
  }
}

function personalPayload() {
  return {
    data: {
      isPaid: true,
      status: 'active',
      seats: null,
      stripeSubscriptionId: 'sub-personal',
      periodEnd: null,
      tier: tier('tier-personal', 'Personal Pro', 'user'),
      usage: {
        current: 2,
        limit: 20,
        percentUsed: 10,
        isWarning: false,
        isExceeded: false,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        lastPeriodCost: 0,
      },
    },
  }
}

function organizationPayload() {
  return {
    organizationId: 'org-billing',
    billingEnabled: true,
    subscriptionTier: tier('tier-org', 'Organization Pro', 'organization', {
      usageScope: 'pooled',
      seatMode: 'adjustable',
      seatCount: 3,
    }),
    subscriptionStatus: 'active',
    totalSeats: 3,
    totalCurrentUsage: 10,
    totalUsageLimit: 100,
    minimumUsageLimit: 100,
    warningThresholdPercent: 80,
    billingPeriodEnd: null,
    billingBlocked: false,
    userRole: 'admin',
  }
}

function organizationSeats(memberSeats = 4, pendingInvitations = 0) {
  return {
    organizationId: 'org-billing',
    maxSeats: 0,
    usedSeats: memberSeats + pendingInvitations,
    memberSeats,
    pendingInvitations,
    availableSeats: 0,
    tier: null,
    canModifySeats: false,
    seatMode: null,
    seatMaximum: null,
  }
}

function catalogTier(
  id: string,
  displayName: string,
  ownerType: 'user' | 'organization',
  displayOrder: number
) {
  return {
    id,
    displayName,
    description: '',
    ownerType,
    usageScope: ownerType === 'organization' ? 'pooled' : 'individual',
    seatMode: ownerType === 'organization' ? 'adjustable' : 'fixed',
    displayOrder,
    monthlyPriceUsd: 12.5,
    yearlyPriceUsd: null,
    hasStripeMonthlyPriceId: true,
    seatCount: ownerType === 'organization' ? 2 : null,
    seatMaximum: null,
    canEditUsageLimit: false,
    pricingFeatures: [],
    isDefault: false,
  }
}

function workspaceBillingOwner(
  billingOwner: { type: 'user'; userId: string } | { type: 'organization'; organizationId: string }
) {
  return {
    settings: {
      workspace: {
        id: mocks.workspaceId,
        ownerId: 'user-1',
        permissions: 'admin',
        billingOwner,
      },
    },
    permissions: { users: [], currentUserPermission: 'admin' },
  }
}

describe('Subscription billing subject', () => {
  let container: HTMLDivElement
  let queryClient: QueryClient
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    mocks.organizationBilling = organizationPayload()
    mocks.organizationBillingError = false
    mocks.organizationBillingId = ''
    mocks.organizationBillingPlaceholder = false
    mocks.personalBilling = personalPayload()
    mocks.handleUpgrade.mockReset()
    mocks.getFullOrganization.mockReset().mockImplementation(() => {
      throw new Error('Subscription must not fetch the member roster')
    })
    mocks.privateTiers = []
    mocks.privateTierAccessError = null
    mocks.publicTiers = []
    mocks.workspaceId = 'workspace-1'
    mocks.workspaceSettings = workspaceBillingOwner({ type: 'user', userId: 'user-1' })
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(organizationKeys.seats('org-billing'), organizationSeats())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: organizationSeats() }),
      })
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    expect(mocks.getFullOrganization).not.toHaveBeenCalled()
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  function render(locale: LocaleCode = 'en', onOpenChange = vi.fn()) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
            <Subscription onOpenChange={onOpenChange} />
          </NextIntlClientProvider>
        </QueryClientProvider>
      )
    })
    return onOpenChange
  }

  it('uses the exact workspace billing organization while keeping redemption user-scoped', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })

    render()

    expect(mocks.organizationBillingId).toBe('org-billing')
    expect(container.textContent).toContain('Organization Pro')
    expect(container.textContent).not.toContain('Personal Pro')
    expect(container.querySelector('#private-tier-access-code')).not.toBeNull()
  })

  it('uses personal billing when the workspace billing owner is the session user', () => {
    render()

    expect(container.textContent).toContain('Personal Pro')
    expect(container.textContent).not.toContain('Organization Pro')
    expect(container.querySelector('#private-tier-access-code')).not.toBeNull()
  })

  it('does not render keep-previous billing data while the organization owner changes', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      organizationId: 'org-previous',
      subscriptionTier: tier('tier-previous', 'Previous Organization', 'organization'),
    }
    mocks.organizationBillingPlaceholder = true

    render()

    expect(container.textContent).not.toContain('Previous Organization')
    expect(container.textContent).not.toContain('Personal Pro')
  })

  it('does not substitute viewer billing when another user owns billing', () => {
    mocks.workspaceSettings = workspaceBillingOwner({ type: 'user', userId: 'user-2' })

    render()

    expect(container.textContent).toContain(
      "This workspace's billing is managed by another workspace administrator."
    )
    expect(container.textContent).not.toContain('Personal Pro')
    expect(container.querySelector('[data-testid="billing-owner-editor"]')).not.toBeNull()
  })

  it('keeps an inaccessible organization workspace open in repair-only mode', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = null
    mocks.organizationBillingError = true
    const onOpenChange = render()

    expect(container.textContent).toContain('You cannot access this billing organization.')
    expect(container.querySelector('[data-testid="billing-owner-editor"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Personal Pro')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each([2, 51])(
    'quotes all %i members and pending invitations from aggregate counts without an active subscription',
    async (memberSeats) => {
      mocks.workspaceSettings = workspaceBillingOwner({
        type: 'organization',
        organizationId: 'org-billing',
      })
      mocks.organizationBilling = {
        ...organizationPayload(),
        subscriptionTier: null,
        totalSeats: 0,
        usedSeats: 2,
        userRole: 'owner',
      }
      mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
      const occupied = memberSeats + 3
      queryClient.setQueryData(organizationKeys.seats('org-active'), {
        ...organizationSeats(1),
        organizationId: 'org-active',
      })
      let finish!: () => void
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({
                ok: true,
                json: async () => ({ success: true, data: organizationSeats(memberSeats, 3) }),
              } as Response)
          })
      )
      queryClient.removeQueries({ queryKey: organizationKeys.seats('org-billing'), exact: true })

      render()
      expect(container.querySelector('[data-testid="plan-card"]')).toBeDisabled()
      expect(container.textContent).toContain('Organization Public')
      expect(container.querySelector('#private-tier-access-code')).not.toBeNull()
      expect(fetch).toHaveBeenCalledWith('/api/organizations/org-billing/seats')
      expect(mocks.handleUpgrade).not.toHaveBeenCalled()
      await act(async () => {
        finish()
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(organizationKeys.seats('org-billing'))?.status).toBe(
            'success'
          )
        )
      })
      act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click())

      const dialog = document.querySelector('[role="dialog"]')!
      const seats = dialog.querySelector<HTMLInputElement>('#seats')!
      expect(seats).toHaveAttribute('min', String(occupied))
      expect(seats).toHaveValue(occupied)
      expect(dialog.textContent).toContain(memberSeats === 2 ? '$62.50' : '$675.00')
      expect(dialog.textContent).not.toContain('$25.00')
      const confirm = Array.from(dialog.querySelectorAll('button')).find(
        (button) => button.textContent === 'Upgrade'
      )!
      await act(async () => confirm.click())
      expect(mocks.handleUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tier-org-public' }),
        { organizationId: 'org-billing', seats: occupied }
      )
    }
  )

  it.each([
    ['workspace and organization', 'workspace-2', 'org-other'],
    ['billing organization in the same workspace', 'workspace-1', 'org-other'],
    ['workspace with the same billing organization', 'workspace-2', 'org-billing'],
    ['organization billing to user billing', 'workspace-1', ''],
  ])('discards an open upgrade when changing %s', async (_scope, workspaceId, organizationId) => {
    mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
    const switchSubject = (workspaceId: string, organizationId: string, occupiedSeats: number) => {
      mocks.workspaceId = workspaceId
      mocks.workspaceSettings = workspaceBillingOwner(
        organizationId
          ? { type: 'organization', organizationId }
          : { type: 'user', userId: 'user-1' }
      )
      mocks.organizationBilling = {
        ...organizationPayload(),
        organizationId,
        subscriptionTier: null,
        totalSeats: 0,
        userRole: 'owner',
      }
      queryClient.setQueryData(organizationKeys.seats(organizationId), {
        ...organizationSeats(occupiedSeats),
        organizationId,
      })
      render()
    }
    switchSubject('workspace-1', 'org-billing', 4)
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click())
    expect(document.querySelector('#seats')).toHaveValue(4)
    await act(async () => {
      const seats = document.querySelector<HTMLInputElement>('#seats')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(seats, '7')
      seats.dispatchEvent(new Event('input', { bubbles: true }))
      await queryClient.refetchQueries({ queryKey: organizationKeys.seats('org-billing') })
    })
    expect(document.querySelector('#seats')).toHaveValue(7)

    switchSubject(workspaceId, organizationId, 2)
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    switchSubject('workspace-1', 'org-billing', 4)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    switchSubject(workspaceId, organizationId, 2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
    if (!organizationId) return

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click())
    expect(document.querySelector('#seats')).toHaveAttribute('min', '2')
    expect(document.querySelector('#seats')).toHaveValue(2)
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent === 'Upgrade'
    ) as HTMLButtonElement
    await act(async () => confirm.click())
    expect(mocks.handleUpgrade).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'tier-org-public' }),
      { organizationId, seats: 2 }
    )
  })

  it('never quotes another organization from cached counts while preserving the billing surface', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = { ...organizationPayload(), userRole: 'owner' }
    mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
    queryClient.setQueryData(organizationKeys.seats('org-billing'), {
      ...organizationSeats(),
      organizationId: 'org-active',
    })
    render()
    expect(container.textContent).toContain('Organization Pro')
    expect(container.querySelector('[data-testid="plan-card"]')).toBeDisabled()
    expect(container.querySelector('[data-testid="billing-owner-editor"]')).not.toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
  })

  it('keeps usage and plan management available while aggregate counts load or fail', async () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      userRole: 'owner',
      subscriptionTier: { ...organizationPayload().subscriptionTier, canEditUsageLimit: true },
    }
    mocks.publicTiers = [
      catalogTier('tier-org-public', 'Organization Public', 'organization', 1),
      {
        ...catalogTier('tier-org-fixed', 'Organization Fixed', 'organization', 2),
        seatMode: 'fixed',
      },
    ]
    queryClient.removeQueries({ queryKey: organizationKeys.seats('org-billing'), exact: true })
    let fail!: (error: Error) => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    render()
    const adjustablePlan = () =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Organization Public')
      )!
    const fixedPlan = () =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Organization Fixed')
      )!
    expect(container.textContent).toContain('Organization Pro')
    expect(container.querySelector('[data-testid="usage-limit"]')).not.toBeNull()
    expect(adjustablePlan()).toBeDisabled()
    expect(fixedPlan()).toBeEnabled()
    expect(container.textContent).toContain(
      getPublicCopy('en').workspace.settingsModal.subscription.titles.manage
    )
    await act(async () => {
      fail(new Error('Counts unavailable'))
      await vi.waitFor(() =>
        expect(queryClient.getQueryState(organizationKeys.seats('org-billing'))?.status).toBe(
          'error'
        )
      )
    })
    expect(container.querySelector('[data-testid="usage-limit"]')).not.toBeNull()
    expect(adjustablePlan()).toBeDisabled()
    expect(fixedPlan()).toBeEnabled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      getPublicCopy('en').workspace.settingsModal.subscription.errors.unknown
    )
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === getPublicCopy('en').workspace.permissionsFeedback.retry
    )!
    await act(async () => {
      retry.click()
      await vi.waitFor(() =>
        expect(queryClient.getQueryState(organizationKeys.seats('org-billing'))?.status).toBe(
          'success'
        )
      )
    })
    expect(adjustablePlan()).toBeEnabled()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not request billing-only seat counts when billing is disabled', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      billingEnabled: false,
      userRole: 'owner',
    }
    queryClient.removeQueries({ queryKey: organizationKeys.seats('org-billing'), exact: true })
    render()
    expect(container.textContent).toContain('Organization Pro')
    expect(container.querySelector('#private-tier-access-code')).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not expose a retained seat-count error after organization billing is disabled', async () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      billingEnabled: false,
      userRole: 'owner',
    }
    queryClient.removeQueries({ queryKey: organizationKeys.seats('org-billing'), exact: true })
    await queryClient
      .fetchQuery({
        queryKey: organizationKeys.seats('org-billing'),
        queryFn: async () => {
          throw new Error('Previous count failed')
        },
      })
      .catch(() => {})
    render()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { monthly: 12.5, yearly: 120, amount: '$50.00' },
    { monthly: 0, yearly: 120, amount: '$0.00' },
    { monthly: null, yearly: 120, amount: null },
    { monthly: null, yearly: null, amount: null },
  ])(
    'keeps monthly checkout available regardless of display prices ($monthly/$yearly)',
    async ({ monthly, yearly, amount }) => {
      mocks.workspaceSettings = workspaceBillingOwner({
        type: 'organization',
        organizationId: 'org-billing',
      })
      mocks.organizationBilling = {
        ...organizationPayload(),
        subscriptionTier: null,
        totalSeats: 0,
        userRole: 'owner',
      }
      mocks.privateTiers = [
        {
          ...catalogTier('tier-priced', 'Priced tier', 'organization', 1),
          monthlyPriceUsd: monthly,
          yearlyPriceUsd: yearly,
        },
      ]
      render()
      act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click())
      const dialog = document.querySelector('[role="dialog"]')!
      if (amount === null) expect(dialog.textContent).not.toContain('$')
      else expect(dialog.textContent).toContain(`${amount} per month`)
      expect(dialog.querySelector('#seats')).toHaveValue(4)
      const confirm = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent === 'Upgrade'
      )!
      await act(async () => confirm.click())
      expect(mocks.handleUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tier-priced', hasStripeMonthlyPriceId: true }),
        {
          organizationId: 'org-billing',
          seats: 4,
        }
      )
    }
  )

  it('starts a monthly fixed tier without opening seat selection', async () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      subscriptionTier: null,
      totalSeats: 0,
      userRole: 'owner',
    }
    mocks.publicTiers = [
      {
        ...catalogTier('tier-fixed', 'Fixed annual', 'organization', 1),
        seatMode: 'fixed',
        seatCount: 4,
        monthlyPriceUsd: null,
        yearlyPriceUsd: 120,
      },
    ]
    render()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click()
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.handleUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tier-fixed', hasStripeMonthlyPriceId: true }),
      { organizationId: 'org-billing' }
    )
  })

  it.each(['capacity', 'unpriced'])('does not offer an %s tier as a valid upgrade', (issue) => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
      subscriptionTier: null,
      totalSeats: 0,
      userRole: 'owner',
    }
    mocks.publicTiers = [
      {
        ...catalogTier('tier-blocked', 'Blocked tier', 'organization', 1),
        ...(issue === 'capacity'
          ? { seatMaximum: 3 }
          : { monthlyPriceUsd: null, yearlyPriceUsd: 120, hasStripeMonthlyPriceId: false }),
      },
    ]
    render()
    const plan = container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!
    expect(plan).toBeDisabled()
    act(() => plan.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
    if (issue === 'capacity')
      expect(container.textContent).toContain('at most 3 seats, but 4 are required')
  })

  it.each([
    { licensedSeats: 0, selectedSeats: 8, expectedSeats: 8 },
    { licensedSeats: 20, selectedSeats: null, expectedSeats: 10 },
  ])('selects private tier seats with $licensedSeats licenses', async (testCase) => {
    const { licensedSeats, selectedSeats, expectedSeats } = testCase
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      organizationId: 'org-billing',
      billingEnabled: true,
      subscriptionTier: licensedSeats ? organizationPayload().subscriptionTier : null,
      subscriptionStatus: licensedSeats ? 'active' : null,
      totalSeats: licensedSeats,
      usedSeats: 4,
      userRole: 'owner',
    }
    mocks.publicTiers = [
      catalogTier('tier-personal-public', 'Personal Public', 'user', 0),
      catalogTier('tier-org-public', 'Organization Public', 'organization', 1),
    ]
    mocks.privateTiers = [
      {
        ...catalogTier('tier-org-private', 'Organization Private', 'organization', 2),
        seatMaximum: 10,
      },
    ]

    render()

    expect(container.textContent).toContain('Organization Public:Change to Organization Public')
    expect(container.textContent).toContain('Organization Private:Change to Organization Private')
    expect(container.textContent).not.toContain('Personal Public')
    expect(container.querySelector('#private-tier-access-code')).not.toBeNull()

    const privatePlan = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Organization Private')
    )
    expect(privatePlan).toHaveAttribute('data-price', '$12.50')
    act(() => privatePlan?.click())

    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"]')!
    const seatsInput = dialog.querySelector<HTMLInputElement>('#seats')!
    expect(seatsInput).toHaveValue(licensedSeats ? 10 : 4)
    if (selectedSeats !== null) {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          seatsInput,
          String(selectedSeats)
        )
        seatsInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Upgrade'
    )!
    await act(async () => confirm.click())

    expect(mocks.handleUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tier-org-private', ownerType: 'organization' }),
      { organizationId: 'org-billing', seats: expectedSeats }
    )
  })

  it('renders private access errors through locale copy', () => {
    mocks.privateTierAccessError = new Error(PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed)

    render('es')

    expect(container.textContent).toContain('No se pudo cargar su acceso a niveles privados.')
  })
})
