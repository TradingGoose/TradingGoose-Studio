/** @vitest-environment jsdom */

import { act, cloneElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { Organization } from '@/lib/organization'
import { type OrganizationSeats, organizationKeys } from '@/hooks/queries/organization'
import type { WorkspaceSettingsResponse } from '@/hooks/queries/workspace'
import { getClientMessages } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { UsageHeader } from './shared/usage-header'
import { WorkspaceBillingOwnerEditor } from './subscription/components/workspace-billing-owner'
import { MemberInvitationCard } from './team-management/components/member-invitation-card/member-invitation-card'
import { NoOrganizationView } from './team-management/components/no-organization-view/no-organization-view'
import { TeamSeats } from './team-management/components/team-seats/team-seats'
import { TeamSeatsOverview } from './team-management/components/team-seats-overview/team-seats-overview'
import { TeamManagement } from './team-management/team-management'

vi.unmock('next-intl')

const mocks = vi.hoisted(() => ({
  organization: null as Organization | null,
  organizationDetail: undefined as Organization | null | undefined,
  billing: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  mutate: vi.fn(),
  publicTiers: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { id: 'user-1', name: 'Ana', email: 'ana@example.com' } },
  }),
}))

vi.mock('@/lib/subscription/upgrade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscription/upgrade')>()),
  useSubscriptionUpgrade: () => ({ handleUpgrade: mocks.mutate }),
}))

vi.mock('@/hooks/queries/organization', async (importOriginal) => {
  const mutation = () => ({ mutationFn: mocks.mutate })
  return {
    ...(await importOriginal<typeof import('@/hooks/queries/organization')>()),
    useOrganizations: () => ({ data: { activeOrganization: mocks.organization } }),
    useOrganization: () => ({
      data: mocks.organizationDetail === undefined ? mocks.organization : mocks.organizationDetail,
      isLoading: false,
    }),
    useOrganizationBilling: () => ({ data: mocks.billing, isLoading: false }),
    useOrganizationBillingWorkspaces: () => ({ data: [], isLoading: false }),
    useAvailableOrganizationBillingWorkspaces: () => ({ data: [], isLoading: false }),
    organizationMutationOptions: {
      inviteMember: mutation,
      removeMember: mutation,
      updateSeats: mutation,
      createOrganization: mutation,
      assignWorkspace: mutation,
      cancelInvitation: mutation,
      releaseWorkspace: mutation,
    },
  }
})

vi.mock('@/hooks/queries/workspace', () => ({
  useAdminWorkspaces: () => ({ data: [], refetch: mocks.refetch }),
  workspaceMutationOptions: { updateSettings: () => ({ mutationFn: mocks.mutate }) },
}))

vi.mock('@/hooks/queries/public-billing-catalog', () => ({
  usePublicBillingCatalog: () => ({ data: { publicTiers: mocks.publicTiers }, isLoading: false }),
}))

vi.mock('@/hooks/queries/private-tier-access', () => ({
  usePrivateTierAccessForm: () => ({
    accessCode: '',
    mutation: { isPending: false, isSuccess: false },
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    query: { data: { privateTiers: [] }, isLoading: false },
  }),
}))

vi.mock('./team-management/components', async () => ({
  MemberInvitationCard: () => null,
  NoOrganizationView: ({ orgName }: { orgName: string }) => (
    <output data-testid='default-team-name'>{orgName}</output>
  ),
  RemoveMemberDialog: () => null,
  TeamMembers: (await import('./team-management/components/team-members/team-members')).TeamMembers,
  TeamSeats: (await import('./team-management/components/team-seats/team-seats')).TeamSeats,
  TeamSeatsOverview: (
    await import('./team-management/components/team-seats-overview/team-seats-overview')
  ).TeamSeatsOverview,
  TeamUsage: () => null,
  WorkspaceBilling: () => null,
}))

describe('settings localization', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  const onIntlError = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organization = null
    mocks.organizationDetail = undefined
    mocks.billing = null
    mocks.publicTiers = []
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    queryClient.setQueryData(organizationKeys.seats('org-1'), {
      organizationId: 'org-1',
      maxSeats: 0,
      usedSeats: 4,
      memberSeats: 4,
      pendingInvitations: 0,
      availableSeats: 0,
      tier: null,
      canModifySeats: false,
      seatMode: null,
      seatMaximum: null,
    } satisfies OrganizationSeats)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: [] }))
    )
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    vi.unstubAllGlobals()
    expect(onIntlError).not.toHaveBeenCalled()
  })

  async function render(locale: LocaleCode, children: ReactNode) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={getClientMessages(locale)}
          timeZone='UTC'
          onError={onIntlError}
        >
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      )
    })
  }

  function enterSeats(value: number) {
    const input = document.querySelector<HTMLInputElement>('#seats')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        String(value)
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it.each([
    ['es', 'Propietario de facturación', 'Organización'],
    ['zh', '账单所有者', '组织'],
  ] as const)('translates the billing owner editor in %s', async (locale, title, organization) => {
    const workspaceSettings: WorkspaceSettingsResponse = {
      settings: {
        workspace: {
          id: 'workspace-1',
          ownerId: 'user-1',
          billingOwner: { type: 'organization', organizationId: 'org-1' },
          permissions: 'admin',
        },
      },
      permissions: { users: [], currentUserPermission: 'admin' },
    }

    await render(
      locale,
      <WorkspaceBillingOwnerEditor isLoading={false} workspaceSettings={workspaceSettings} />
    )

    expect(container.querySelector('h4')?.textContent).toBe(title)
    expect(container.querySelector('[role="combobox"]')?.textContent).toBe(organization)
    expect(container.querySelector('[role="combobox"]')).toHaveAccessibleName(title)
    expect(container.querySelector('label')).toBeNull()
    expect(container.textContent).not.toContain('Choose which admin account')
    expect(container.textContent).not.toContain('User billing must point')
  })

  it.each([
    ['en', 'How this team billing works', 'Owner'],
    ['es', 'Cómo funciona la facturación de este equipo', 'Propietario'],
    ['zh', '此团队计费方式', '拥有者'],
  ] as const)('translates team billing and metadata in %s', async (locale, title, role) => {
    mocks.organization = {
      id: 'org-1',
      name: 'Design team',
      slug: 'design-team',
      createdAt: '2025-06-15T12:00:00Z',
      members: [{ id: 'member-1', role: 'owner', user: { email: 'ana@example.com' } }],
    }
    mocks.billing = {
      organizationId: 'org-1',
      billingEnabled: true,
      subscriptionTier: {
        ...EMPTY_BILLING_TIER_SUMMARY,
        id: 'org-tier',
        displayName: 'Organization Pro',
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        monthlyPriceUsd: 12.5,
      },
      totalSeats: 2,
      totalCurrentUsage: 0,
      totalUsageLimit: 25,
    }

    await render(locale, <TeamManagement />)

    expect(container.textContent).toContain(title)
    expect(
      Array.from(container.querySelectorAll('span')).filter((span) => span.textContent === role)
    ).toHaveLength(2)
    expect(container.textContent).toContain(
      new Date(mocks.organization.createdAt).toLocaleDateString(locale)
    )
    if (locale !== 'en') {
      expect(container.textContent).not.toContain('Organization plans')
      expect(container.textContent).not.toContain('Team ID:')
      expect(container.textContent).not.toContain('licensed seats')
    }
  })

  it.each([
    { licensedSeats: 0, selectedSeats: 8, expectedSeats: 8 },
    { licensedSeats: 20, selectedSeats: null, expectedSeats: 10 },
  ])('selects organization seats with $licensedSeats licenses', async (testCase) => {
    const { licensedSeats, selectedSeats, expectedSeats } = testCase
    mocks.organization = {
      id: 'org-1',
      name: 'Design team',
      slug: 'design-team',
      createdAt: '2025-06-15T12:00:00Z',
      members: [
        { id: 'member-1', role: 'owner', user: { email: 'ana@example.com' } },
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `member-${index + 2}`,
          role: 'member',
          user: { email: `member-${index + 2}@example.com` },
        })),
      ],
    }
    mocks.billing = {
      organizationId: 'org-1',
      billingEnabled: true,
      subscriptionTier: licensedSeats
        ? {
            ...EMPTY_BILLING_TIER_SUMMARY,
            id: 'current-org-tier',
            displayName: 'Current organization tier',
            ownerType: 'organization',
            usageScope: 'pooled',
            seatMode: 'adjustable',
            hasStripeMonthlyPriceId: true,
          }
        : null,
      totalSeats: licensedSeats,
      totalCurrentUsage: 0,
      totalUsageLimit: 0,
    }
    mocks.publicTiers = [
      {
        id: 'tier-org',
        displayName: 'Organization Pro',
        description: '',
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        seatCount: 2,
        seatMaximum: 10,
        monthlyPriceUsd: 12.5,
        yearlyPriceUsd: null,
        displayOrder: 0,
        pricingFeatures: [],
        canEditUsageLimit: false,
        isDefault: false,
      },
    ]

    await render('es', <TeamManagement />)
    const plan = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Organization Pro')
    )!
    await act(async () => plan.click())

    expect(mocks.mutate).not.toHaveBeenCalled()
    const dialog = document.querySelector('[role="dialog"]')!
    const seatsInput = dialog.querySelector<HTMLInputElement>('#seats')!
    expect(seatsInput).toHaveValue(licensedSeats ? 10 : 4)
    if (selectedSeats !== null) enterSeats(selectedSeats)
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent === 'Configurar suscripción de equipo'
    )!
    await act(async () => confirm.click())

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ billingTierId: 'tier-org', ownerType: 'organization' }),
      { organizationId: 'org-1', seats: expectedSeats }
    )
  })

  describe('team seat aggregate quotes', () => {
    let counts: OrganizationSeats
    const plan = () =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Organization Pro')
      )!
    const confirm = () =>
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (button) =>
          button.textContent ===
          getClientMessages('en').workspace.settingsModal.team.setUpTeamSubscription
      ) as HTMLButtonElement

    beforeEach(() => {
      mocks.organization = {
        id: 'org-1',
        name: 'Design team',
        slug: 'design-team',
        createdAt: '2025-06-15T12:00:00Z',
        members: [{ id: 'owner', role: 'owner', user: { email: 'ana@example.com' } }],
        invitations: Array.from({ length: 100 }, (_, index) => ({
          id: `canceled-${index}`,
          email: `canceled-${index}@example.com`,
          status: 'canceled',
        })),
      }
      mocks.billing = {
        organizationId: 'org-1',
        billingEnabled: true,
        subscriptionTier: null,
        totalSeats: 0,
        totalCurrentUsage: 0,
        totalUsageLimit: 0,
      }
      mocks.publicTiers = [
        {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'tier-org',
          displayName: 'Organization Pro',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatMode: 'adjustable',
          seatCount: 2,
          seatMaximum: 80,
          monthlyPriceUsd: 12.5,
          yearlyPriceUsd: null,
          pricingFeatures: [],
          isDefault: false,
        },
      ]
      counts = {
        ...queryClient.getQueryData<OrganizationSeats>(organizationKeys.seats('org-1'))!,
        memberSeats: 1,
        pendingInvitations: 49,
        usedSeats: 50,
      }
      queryClient.setQueryData(organizationKeys.seats('org-1'), counts)
    })

    it('quotes pending invitations omitted from a full canceled-invitation roster before the first plan', async () => {
      await render('en', <TeamManagement />)
      await act(async () => plan().click())
      const dialog = document.querySelector('[role="dialog"]')!
      expect(dialog.querySelector('#seats')).toHaveAttribute('min', '50')
      expect(dialog.querySelector('#seats')).toHaveValue(50)
      expect(dialog.textContent).toContain('$625.00')
      await act(async () => confirm().click())
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ billingTierId: 'tier-org' }),
        { organizationId: 'org-1', seats: 50 }
      )
    })

    it.each([
      { monthly: null, yearly: 120, amount: '$6,000.00', interval: 'year', annual: true },
      { monthly: 12.5, yearly: 120, amount: '$625.00', interval: 'month', annual: false },
      { monthly: 0, yearly: 120, amount: '$0.00', interval: 'month', annual: false },
    ])(
      'uses the actual $interval quote and native interval for team upgrades ($monthly/$yearly)',
      async ({ monthly, yearly, amount, interval, annual }) => {
        mocks.publicTiers[0] = {
          ...mocks.publicTiers[0],
          monthlyPriceUsd: monthly,
          yearlyPriceUsd: yearly,
        }
        await render('en', <TeamManagement />)
        await act(async () => plan().click())
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
          `${amount} per ${interval}`
        )
        await act(async () => confirm().click())
        expect(mocks.mutate).toHaveBeenCalledWith(
          expect.objectContaining({ billingTierId: 'tier-org' }),
          { organizationId: 'org-1', seats: 50, ...(annual ? { annual: true } : {}) }
        )
      }
    )

    it('uses annual billing for fixed team tiers without a seat dialog', async () => {
      mocks.publicTiers[0] = {
        ...mocks.publicTiers[0],
        monthlyPriceUsd: null,
        yearlyPriceUsd: 120,
        seatMode: 'fixed',
        seatCount: 60,
      }
      await render('en', <TeamManagement />)
      await act(async () => plan().click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ billingTierId: 'tier-org' }),
        { organizationId: 'org-1', seats: 60, annual: true }
      )
    })

    it.each(['capacity', 'unpriced'])('keeps an %s team tier unavailable', async (issue) => {
      mocks.publicTiers[0] = {
        ...mocks.publicTiers[0],
        ...(issue === 'capacity'
          ? { seatMaximum: 10 }
          : { monthlyPriceUsd: null, yearlyPriceUsd: null }),
      }
      await render('en', <TeamManagement />)
      expect(plan()).toBeDisabled()
      await act(async () => plan().click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.mutate).not.toHaveBeenCalled()
      if (issue === 'capacity')
        expect(container.textContent).toContain('at most 10 seats, but 50 are required')
    })

    it('quotes add-seat changes from the current annual-only tier instead of a public monthly tier', async () => {
      mocks.billing = {
        ...mocks.billing,
        totalSeats: 60,
        subscriptionTier: {
          ...EMPTY_BILLING_TIER_SUMMARY,
          id: 'current-annual',
          displayName: 'Annual current',
          ownerType: 'organization',
          usageScope: 'pooled',
          seatMode: 'adjustable',
          seatCount: 2,
          seatMaximum: 80,
          monthlyPriceUsd: null,
          yearlyPriceUsd: 120,
          hasStripeMonthlyPriceId: false,
        },
      }
      await render('en', <TeamManagement />)
      expect(container.textContent).toContain('a minimum of $7,200.00/year')
      expect(container.textContent).not.toContain('$7,200.00/month')
      expect(container.textContent).toContain('($120.00/year each)')
      const copy = getClientMessages('en').workspace.settingsModal.team
      const add = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === copy.addSeat
      )!
      await act(async () => add.click())
      const dialog = document.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain('$7,320.00 per year')
      expect(dialog.textContent).toContain('Annual cost change:')
      expect(dialog.textContent).not.toContain('per month')
      const update = [...dialog.querySelectorAll('button')].find(
        (button) => button.textContent === copy.addSeats.confirm
      )!
      await act(async () => update.click())
      expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({ orgId: 'org-1', seats: 61 })
    })

    it('keeps billing visible but blocks quotes until failed aggregate counts are retried', async () => {
      queryClient.removeQueries({ queryKey: organizationKeys.seats('org-1'), exact: true })
      let fail!: (error: Error) => void
      const pending = new Promise<Response>((_resolve, reject) => {
        fail = reject
      })
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).endsWith('/seats') ? pending : Response.json({ data: [] })
      )
      await render('en', <TeamManagement />)
      expect(plan()).toBeDisabled()
      expect(container.querySelector('#organization-private-tier-access-code')).not.toBeNull()
      await act(async () => {
        fail(new Error('Counts unavailable'))
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(organizationKeys.seats('org-1'))?.status).toBe('error')
        )
      })
      expect(plan()).toBeDisabled()
      expect(container.querySelector('#organization-private-tier-access-code')).not.toBeNull()
      expect(mocks.mutate).not.toHaveBeenCalled()
      vi.mocked(fetch).mockResolvedValue(Response.json({ data: counts }))
      const retry = [...container.querySelectorAll('button')].find(
        (button) =>
          button.textContent === getClientMessages('en').workspace.permissionsFeedback.retry
      )!
      await act(async () => {
        retry.click()
        await vi.waitFor(() => expect(plan()).toBeEnabled())
      })
      await act(async () => plan().click())
      expect(document.querySelector('#seats')).toHaveValue(50)
    })

    it('discards the old quote while another organization has stale detail and pending counts', async () => {
      await render('en', <TeamManagement />)
      await act(async () => plan().click())
      expect(document.querySelector('#seats')).toHaveValue(50)
      mocks.organizationDetail = mocks.organization
      mocks.organization = { ...mocks.organization!, id: 'org-2', name: 'Second team' }
      mocks.billing = { ...mocks.billing, organizationId: 'org-2' }
      let finish!: (response: Response) => void
      const pending = new Promise<Response>((resolve) => {
        finish = resolve
      })
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).endsWith('/seats') ? pending : Response.json({ data: [] })
      )
      await render('en', <TeamManagement />)
      expect(fetch).toHaveBeenCalledWith('/api/organizations/org-2/seats')
      expect(plan()).toBeDisabled()
      await vi.waitFor(() => expect(document.querySelector('#seats')).toBeNull())
      expect(mocks.mutate).not.toHaveBeenCalled()
      mocks.organizationDetail = mocks.organization
      await act(async () => {
        finish(
          Response.json({
            data: { ...counts, organizationId: 'org-2', usedSeats: 2, pendingInvitations: 1 },
          })
        )
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(organizationKeys.seats('org-2'))?.status).toBe('success')
        )
      })
      await render('en', <TeamManagement />)
      await act(async () => plan().click())
      expect(document.querySelector('#seats')).toHaveAttribute('min', '2')
      expect(document.querySelector('#seats')).toHaveValue(2)
      await act(async () => confirm().click())
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ billingTierId: 'tier-org' }),
        { organizationId: 'org-2', seats: 2 }
      )
    })

    it('does not fetch or surface retained seat errors without enabled organization billing', async () => {
      queryClient.removeQueries({ queryKey: organizationKeys.seats('org-1'), exact: true })
      await queryClient
        .fetchQuery({
          queryKey: organizationKeys.seats('org-1'),
          queryFn: async () => {
            throw new Error('Previous seat request failed')
          },
          retry: false,
        })
        .catch(() => {})
      for (const billing of [null, { ...mocks.billing, billingEnabled: false }]) {
        mocks.billing = billing
        await render('en', <TeamManagement />)
        expect(fetch).not.toHaveBeenCalledWith('/api/organizations/org-1/seats')
        expect(container.textContent).not.toContain(
          getClientMessages('en').workspace.settingsModal.team.errors.loadOrganizationBilling
        )
      }
    })
  })

  it('bounds initial seats and resets them when reopening or constraints change', async () => {
    const dialog = (
      <TeamSeats
        open
        onOpenChange={vi.fn()}
        title='Seats'
        description='Select seats'
        pricePerSeat={10}
        billingInterval='month'
        minimumSeats={4}
        maximumSeats={10}
        initialSeats={20}
        isLoading={false}
        onConfirm={mocks.mutate}
        confirmButtonText='Confirm'
      />
    )
    const seats = () => document.querySelector<HTMLInputElement>('#seats')!

    await render('en', dialog)
    expect(seats()).toHaveValue(10)
    enterSeats(8)
    await render('en', cloneElement(dialog, { initialSeats: 30 }))
    expect(seats()).toHaveValue(10)
    enterSeats(8)
    await render('en', cloneElement(dialog, { open: false }))
    await render('en', dialog)
    expect(seats()).toHaveValue(10)

    const lowInitial = cloneElement(dialog, { initialSeats: 2, minimumSeats: 1 })
    await render('en', lowInitial)
    enterSeats(8)
    await render('en', cloneElement(lowInitial, { maximumSeats: 5 }))
    expect(seats()).toHaveValue(2)
    await render('en', cloneElement(lowInitial, { minimumSeats: 4 }))
    expect(seats()).toHaveValue(4)
    await render('en', cloneElement(dialog, { maximumSeats: null }))
    expect(seats()).toHaveValue(20)
    await render('en', cloneElement(dialog, { minimumSeats: 12 }))
    expect(seats()).toHaveValue(12)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'at most 10 seats, but 12 are required'
    )
    const confirm = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) => button.textContent === 'Confirm'
      )!
    expect(confirm()).toBeDisabled()
    await act(async () => confirm().click())
    expect(mocks.mutate).not.toHaveBeenCalled()
    await render('en', dialog)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(confirm()).toBeEnabled()
  })

  it.each([
    ['en', 'per year', 'Annual cost change:'],
    ['es', 'al año', 'Cambio de costo anual:'],
    ['zh', '每年', '年度费用变动：'],
  ] as const)(
    'localizes annual seat totals and cost changes in %s',
    async (locale, period, change) => {
      await render(
        locale,
        <TeamSeats
          open
          onOpenChange={vi.fn()}
          title='Seats'
          description='Annual tier'
          pricePerSeat={120}
          billingInterval='year'
          minimumSeats={4}
          maximumSeats={10}
          initialSeats={4}
          currentSeats={2}
          isLoading={false}
          onConfirm={mocks.mutate}
          confirmButtonText='Confirm'
          showCostBreakdown
        />
      )
      const dialog = document.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain(period)
      expect(dialog.textContent).toContain(change)
      expect(dialog.textContent).toContain(
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(480)
      )
    }
  )

  it.each([
    ['es', 'Equipo de Ana'],
    ['zh', 'Ana 的团队'],
  ] as const)(
    'uses the selected language for the default team name in %s',
    async (locale, name) => {
      await render(locale, <TeamManagement />)
      expect(container.querySelector('[data-testid="default-team-name"]')?.textContent).toBe(name)
    }
  )

  it.each(['es', 'zh'] as const)(
    'localizes shared billing status and currency in %s',
    async (locale) => {
      await render(
        locale,
        <UsageHeader
          title='Organization Pro'
          current={12.5}
          limit={100}
          status='warning'
          percentUsed={75}
        />
      )

      expect(container.textContent).toContain(
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(12.5)
      )
      expect(container.textContent).not.toContain('of your limit used')

      await render(
        locale,
        <UsageHeader title='Organization Pro' current={0} limit={100} isBlocked />
      )
      expect(container.textContent).not.toContain('Payment required')
      expect(container.textContent).not.toContain('Payment failed')
    }
  )

  it.each([
    [
      'es',
      1,
      '1 espacio de trabajo seleccionado',
      'Invitación enviada con acceso a 1 espacio de trabajo.',
    ],
    [
      'es',
      2,
      '2 espacios de trabajo seleccionados',
      'Invitación enviada con acceso a 2 espacios de trabajo.',
    ],
    ['zh', 1, '已选择 1 个工作区', '邀请已发送，并授予 1 个工作区的访问权限。'],
    ['zh', 2, '已选择 2 个工作区', '邀请已发送，并授予 2 个工作区的访问权限。'],
  ] as const)(
    'localizes invitation counts in %s for %i workspaces',
    async (locale, count, selected, success) => {
      const workspaces = Array.from({ length: count }, (_, index) => ({
        id: `workspace-${index}`,
        name: `Workspace ${index}`,
      }))

      const card = (
        <MemberInvitationCard
          inviteEmail='teammate@example.com'
          setInviteEmail={vi.fn()}
          isInviting={false}
          actionsDisabled={false}
          showWorkspaceInvite
          setShowWorkspaceInvite={vi.fn()}
          selectedWorkspaces={workspaces.map(({ id }) => ({ workspaceId: id, permission: 'read' }))}
          userWorkspaces={workspaces}
          onInviteMember={mocks.mutate}
          onLoadUserWorkspaces={mocks.refetch}
          onWorkspaceToggle={vi.fn()}
          invitedWorkspaceCount={count}
          canInviteMembers
          seatLimited={false}
        />
      )

      await render(locale, card)

      expect(container.textContent).toContain(selected)
      expect(container.textContent).toContain(success)
      expect(container.textContent).not.toContain('selected workspace')
      expect(container.textContent).not.toContain('Invitation sent')

      await render(locale, cloneElement(card, { selectedWorkspaces: [] }))

      expect(container.textContent).not.toContain(selected)
      expect(container.textContent).toContain(success)
    }
  )

  it.each([
    ['es', 'Creando…'],
    ['zh', '正在创建…'],
  ] as const)('localizes team creation status and seat pricing in %s', async (locale, creating) => {
    await render(
      locale,
      <>
        <NoOrganizationView
          canCreateOrganization
          orgName='Ana'
          orgSlug='ana'
          setOrgSlug={vi.fn()}
          onOrgNameChange={vi.fn()}
          onCreateOrganization={mocks.mutate}
          isCreatingOrg
          error={null}
        />
        <TeamSeatsOverview
          totalSeats={2}
          pricePerSeat={12.5}
          billingInterval='month'
          isLoadingSubscription={false}
          usedSeats={1}
          actionsDisabled={false}
          isReducing={false}
          onReduceSeats={mocks.mutate}
          onAddSeatDialog={vi.fn()}
        />
      </>
    )

    expect(container.querySelector('[aria-busy="true"]')).toHaveTextContent(creating)
    expect(container.textContent).toContain(
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(12.5)
    )
    expect(container.textContent).not.toContain('/month each')
  })
})
