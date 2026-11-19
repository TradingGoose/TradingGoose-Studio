/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
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
    priceSubtext,
    buttonText,
    onButtonClick,
    buttonDisabled,
  }: {
    name: string
    price?: string
    priceSubtext?: string
    buttonText: string
    onButtonClick: () => void
    buttonDisabled?: boolean
  }) => (
    <button
      type='button'
      data-testid='plan-card'
      data-price={price}
      data-period={priceSubtext}
      onClick={() => onButtonClick()}
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
    vi.stubGlobal('fetch', vi.fn())
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

  it.each(['user', 'organization'] as const)(
    'shows the active annual price and scheduled cancellation for a %s subscription',
    (ownerType) => {
      const periodEnd = '2027-06-01T12:00:00Z'
      const cancelAt = '2027-03-15T12:00:00Z'
      const terms = { billingInterval: 'year', cancelAtPeriodEnd: ownerType === 'user' }
      const currentTier = tier('paid', 'Paid plan', ownerType, {
        monthlyPriceUsd: 12.5,
        yearlyPriceUsd: 120,
      })
      if (ownerType === 'organization') {
        mocks.workspaceSettings = workspaceBillingOwner({
          type: 'organization',
          organizationId: 'org-billing',
        })
        mocks.organizationBilling = {
          ...organizationPayload(),
          ...terms,
          cancelAt,
          billingPeriodEnd: periodEnd,
          subscriptionTier: currentTier,
          userRole: 'owner',
        }
      } else {
        mocks.personalBilling = {
          data: { ...personalPayload().data, ...terms, periodEnd, tier: currentTier },
        }
      }
      render()
      const plan = container.querySelector('[data-testid="plan-card"]')
      expect(plan).toHaveAttribute('data-price', '$120.00')
      expect(plan).toHaveAttribute('data-period', '/yr')
      expect(container.textContent).toContain('Restore Subscription')
      expect(container.textContent).toContain('Subscription ends')
      expect(container.textContent).toContain(
        new Date(ownerType === 'user' ? periodEnd : cancelAt).toLocaleDateString('en')
      )
    }
  )

  it('omits the current price when Stripe has no billing interval', () => {
    mocks.personalBilling = {
      data: {
        ...personalPayload().data,
        billingInterval: null,
        tier: tier('paid', 'Paid plan', 'user', { monthlyPriceUsd: 12.5, yearlyPriceUsd: 120 }),
      },
    }
    render()
    const plan = container.querySelector('[data-testid="plan-card"]')
    expect(plan).toBeInTheDocument()
    expect(plan).not.toHaveAttribute('data-price')
    expect(plan).not.toHaveAttribute('data-period')
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

  it('upgrades the organization selected by the current workspace without fetching seat counts', async () => {
    mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
    for (const [workspaceId, organizationId] of [
      ['workspace-1', 'org-billing'],
      ['workspace-2', 'org-other'],
    ]) {
      mocks.workspaceId = workspaceId
      mocks.workspaceSettings = workspaceBillingOwner({ type: 'organization', organizationId })
      mocks.organizationBilling = {
        ...organizationPayload(),
        organizationId,
        subscriptionTier: null,
        totalSeats: 0,
        userRole: 'owner',
      }
      render()
      const plan = container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!
      expect(plan).toBeEnabled()
      await act(async () => plan.click())
      expect(mocks.handleUpgrade).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'tier-org-public' }),
        { organizationId }
      )
    }

    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([
    { monthly: 12.5, yearly: 120 },
    { monthly: 0, yearly: 120 },
    { monthly: null, yearly: 120 },
    { monthly: null, yearly: null },
  ])(
    'keeps monthly checkout available regardless of display prices ($monthly/$yearly)',
    async ({ monthly, yearly }) => {
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
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click()
      )
      expect(mocks.handleUpgrade).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tier-priced', hasStripeMonthlyPriceId: true }),
        { organizationId: 'org-billing' }
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

  it('does not offer a tier without a configured Stripe price as a valid upgrade', () => {
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
        monthlyPriceUsd: null,
        yearlyPriceUsd: 120,
        hasStripeMonthlyPriceId: false,
      },
    ]
    render()
    const plan = container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!
    expect(plan).toBeDisabled()
    act(() => plan.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
  })

  it('offers accessible private tiers for the current billing organization', async () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.organizationBilling = {
      ...organizationPayload(),
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
    await act(async () => privatePlan?.click())

    expect(mocks.handleUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tier-org-private', ownerType: 'organization' }),
      { organizationId: 'org-billing' }
    )
  })

  it('renders private access errors through locale copy', () => {
    mocks.privateTierAccessError = new Error(PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed)

    render('es')

    expect(container.textContent).toContain('No se pudo cargar su acceso a niveles privados.')
  })
})
