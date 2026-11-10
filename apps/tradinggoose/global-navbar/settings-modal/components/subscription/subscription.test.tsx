/** @vitest-environment jsdom */

import { act } from 'react'
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
  useSession: () => ({ data: { user: { id: 'user-1', email: 'user@example.com' } } }),
  client: { organization: { getFullOrganization: mocks.getFullOrganization } },
}))

vi.mock('@/lib/subscription/upgrade', () => ({
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
  }: {
    name: string
    price: string
    buttonText: string
    onButtonClick: () => void
  }) => (
    <button type='button' data-testid='plan-card' data-price={price} onClick={onButtonClick}>
      {`${name}:${buttonText}`}
    </button>
  ),
  UsageLimit: () => null,
  WorkspaceBillingOwnerEditor: () => <div data-testid='billing-owner-editor' />,
}))

vi.mock('../shared/usage-header', () => ({
  UsageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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

function organizationDetails() {
  return {
    id: 'org-billing',
    name: 'Billing organization',
    slug: 'billing',
    createdAt: new Date(),
    members: [1, 2, 3, 4].map((id) => ({ id: String(id), role: 'member' })),
    invitations: [] as Array<{ id: string; email: string; status: string }>,
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
        id: 'workspace-1',
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
    mocks.getFullOrganization.mockReset().mockResolvedValue({ data: organizationDetails() })
    mocks.privateTiers = []
    mocks.privateTierAccessError = null
    mocks.publicTiers = []
    mocks.workspaceSettings = workspaceBillingOwner({ type: 'user', userId: 'user-1' })
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(organizationKeys.detail('org-billing'), organizationDetails())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
    vi.clearAllMocks()
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

  it('waits for the billing organization before quoting members and pending invitations', async () => {
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
    const organization = {
      ...organizationDetails(),
      members: organizationDetails().members.slice(0, 2),
      invitations: ['pending', 'pending', 'pending', 'cancelled', 'accepted'].map(
        (status, index) => ({
          id: String(index),
          email: `invite-${index}@example.com`,
          status,
        })
      ),
    }
    let finish!: () => void
    mocks.getFullOrganization.mockImplementationOnce(
      (options) =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              data:
                options?.query?.organizationId === 'org-billing'
                  ? organization
                  : { ...organizationDetails(), id: 'org-active' },
            })
        })
    )
    queryClient.removeQueries({ queryKey: organizationKeys.detail('org-billing'), exact: true })

    render()
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull()
    expect(mocks.getFullOrganization).toHaveBeenCalledWith({
      query: { organizationId: 'org-billing' },
    })
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
    await act(async () => {
      finish()
      await vi.waitFor(() =>
        expect(queryClient.getQueryState(organizationKeys.detail('org-billing'))?.status).toBe(
          'success'
        )
      )
    })
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-card"]')!.click())

    const dialog = document.querySelector('[role="dialog"]')!
    const seats = dialog.querySelector<HTMLInputElement>('#seats')!
    expect(seats).toHaveAttribute('min', '5')
    expect(seats).toHaveValue(5)
    expect(dialog.textContent).toContain('$62.50')
    expect(dialog.textContent).not.toContain('$25.00')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Upgrade'
    )!
    await act(async () => confirm.click())
    expect(mocks.handleUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({ billingTierId: 'tier-org-public' }),
      { organizationId: 'org-billing', seats: 5 }
    )
  })

  it('does not quote a different organization while its details are cached', () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
    queryClient.setQueryData(organizationKeys.detail('org-billing'), {
      ...organizationDetails(),
      id: 'org-active',
    })
    render()
    expect(container.textContent).toContain('You cannot access this billing organization.')
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
  })

  it('keeps checkout unavailable when organization details cannot be loaded', async () => {
    mocks.workspaceSettings = workspaceBillingOwner({
      type: 'organization',
      organizationId: 'org-billing',
    })
    mocks.publicTiers = [catalogTier('tier-org-public', 'Organization Public', 'organization', 1)]
    queryClient.removeQueries({ queryKey: organizationKeys.detail('org-billing'), exact: true })
    mocks.getFullOrganization.mockRejectedValueOnce(new Error('Organization unavailable'))
    render()
    await act(async () => {
      await vi.waitFor(() =>
        expect(queryClient.getQueryState(organizationKeys.detail('org-billing'))?.status).toBe(
          'error'
        )
      )
    })
    expect(container.textContent).toContain('You cannot access this billing organization.')
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull()
    expect(mocks.handleUpgrade).not.toHaveBeenCalled()
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
      expect.objectContaining({ billingTierId: 'tier-org-private', ownerType: 'organization' }),
      { organizationId: 'org-billing', seats: expectedSeats }
    )
  })

  it('renders private access errors through locale copy', () => {
    mocks.privateTierAccessError = new Error(PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed)

    render('es')

    expect(container.textContent).toContain('No se pudo cargar su acceso a niveles privados.')
  })
})
