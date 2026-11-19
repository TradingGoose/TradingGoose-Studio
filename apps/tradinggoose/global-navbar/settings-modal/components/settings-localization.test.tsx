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
import { TeamMembers } from './team-management/components/team-members/team-members'
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
      availableSeats: 0,
      seatPrice: null,
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

  it('keeps member usage scoped to the current organization when an earlier request finishes late', async () => {
    let finishEarlier!: (response: Response) => void
    const earlier = new Promise<Response>((resolve) => {
      finishEarlier = resolve
    })
    const usage = (currentPeriodCost: string) =>
      Response.json({ data: [{ userId: 'user-1', currentPeriodCost }] })
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes('/org-1/') ? earlier : usage('22')
    )
    const organization = {
      id: 'org-1',
      name: 'First team',
      slug: 'first-team',
      createdAt: '2025-01-01',
      members: [
        {
          id: 'member-1',
          role: 'owner',
          user: { id: 'user-1', name: 'Ana', email: 'ana@example.com' },
        },
      ],
    }
    const members = (
      <TeamMembers
        organization={organization}
        currentUserEmail='ana@example.com'
        isAdminOrOwner
        actionsDisabled={false}
        onRemoveMember={vi.fn()}
        onCancelInvitation={vi.fn()}
      />
    )
    await render('en', members)
    await render('en', cloneElement(members, { organization: { ...organization, id: 'org-2' } }))
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('$22.00'))
      finishEarlier(usage('91'))
    })
    expect(container.textContent).toContain('$22.00')
    expect(container.textContent).not.toContain('$91.00')
  })

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

  it('starts an adjustable plan directly when occupied seats fit the tier', async () => {
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
      subscriptionTier: {
        ...EMPTY_BILLING_TIER_SUMMARY,
        id: 'current-org-tier',
        displayName: 'Current organization tier',
        ownerType: 'organization',
        usageScope: 'pooled',
        seatMode: 'adjustable',
        hasStripeMonthlyPriceId: true,
      },
      totalSeats: 20,
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
        hasStripeMonthlyPriceId: true,
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

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tier-org', ownerType: 'organization' }),
      { organizationId: 'org-1' }
    )
  })

  describe('team seat aggregate quotes', () => {
    let counts: OrganizationSeats
    const plan = () =>
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Organization Pro')
      )!
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
          hasStripeMonthlyPriceId: true,
          pricingFeatures: [],
          isDefault: false,
        },
      ]
      counts = {
        ...queryClient.getQueryData<OrganizationSeats>(organizationKeys.seats('org-1'))!,
        usedSeats: 50,
      }
      queryClient.setQueryData(organizationKeys.seats('org-1'), counts)
    })

    it('starts a fixed monthly team tier without a seat dialog', async () => {
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
        expect.objectContaining({ id: 'tier-org', hasStripeMonthlyPriceId: true }),
        { organizationId: 'org-1' }
      )
    })

    it('keeps a team tier with insufficient capacity unavailable', async () => {
      mocks.publicTiers[0] = { ...mocks.publicTiers[0], seatMaximum: 10 }
      await render('en', <TeamManagement />)
      expect(plan()).toBeDisabled()
      await act(async () => plan().click())
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.mutate).not.toHaveBeenCalled()
      expect(container.textContent).toContain('at most 10 seats, but 50 are required')
    })

    it('shows a fixed plan’s annual catalog price without a per-seat estimate', async () => {
      mocks.publicTiers[0] = { ...mocks.publicTiers[0], seatMode: 'fixed', yearlyPriceUsd: 800 }
      mocks.billing = {
        ...mocks.billing,
        billingInterval: 'year',
        totalSeats: 60,
        subscriptionTier: mocks.publicTiers[0],
      }
      await render('en', <TeamManagement />)
      expect(container.querySelector('[aria-current="true"]')).toHaveTextContent('$800.00/yr')
      expect(container.textContent).not.toContain('a minimum of')
    })

    it.each([
      {
        billingInterval: 'year',
        monthlyPriceUsd: 12.5,
        seatPrice: { amountUsd: 120, interval: 'year' },
      },
      {
        billingInterval: 'month',
        monthlyPriceUsd: null,
        seatPrice: { amountUsd: 15, interval: 'month' },
      },
      { billingInterval: null, monthlyPriceUsd: 12.5, seatPrice: null },
    ] as const)(
      'uses the active Stripe price $seatPrice to quote licensed seat changes',
      async ({ billingInterval, monthlyPriceUsd, seatPrice }) => {
        mocks.billing = {
          ...mocks.billing,
          totalSeats: 60,
          billingInterval,
          subscriptionTier: {
            ...EMPTY_BILLING_TIER_SUMMARY,
            id: 'current-team',
            displayName: 'Current team',
            ownerType: 'organization',
            usageScope: 'pooled',
            seatMode: 'adjustable',
            seatCount: 2,
            seatMaximum: 80,
            monthlyPriceUsd,
            yearlyPriceUsd: 999,
            hasStripeMonthlyPriceId: true,
          },
        }
        queryClient.setQueryData(organizationKeys.seats('org-1'), {
          ...counts,
          maxSeats: 60,
          availableSeats: 10,
          seatPrice,
        })
        await render('en', <TeamManagement />)
        const copy = getClientMessages('en').workspace.settingsModal.team
        const currentPlan = container.querySelector('[aria-current="true"]')
        expect(currentPlan).toHaveTextContent(
          billingInterval === 'year'
            ? 'Current team · $999.00/yr · Current'
            : 'Current team · Current'
        )
        if (seatPrice?.interval === 'year') {
          expect(container.textContent).toContain('a minimum of $7,200.00/year')
          expect(container.textContent).toContain('($120.00/year each)')
        } else if (seatPrice?.interval === 'month') {
          expect(container.textContent).toContain('a minimum of $900.00/month')
          expect(container.textContent).toContain('($15.00/month each)')
        }
        const remove = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === copy.removeSeat
        )!
        const add = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === copy.addSeat
        )!
        if (seatPrice === null) {
          expect(container.textContent).toContain(copy.addSeats.quoteUnavailable)
          expect(remove).toBeDisabled()
          expect(add).toBeDisabled()
          const updated = {
            ...counts,
            maxSeats: 60,
            seatPrice: { amountUsd: 15, interval: 'month' },
          }
          vi.mocked(fetch).mockResolvedValue(Response.json({ data: updated }))
          const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')!
          await act(async () => {
            retry.click()
            await vi.waitFor(() =>
              expect(queryClient.getQueryData(organizationKeys.seats('org-1'))).toEqual(updated)
            )
          })
          expect(add).toBeEnabled()
          expect(remove).toBeEnabled()
          return
        }
        expect(remove).toBeEnabled()
        await act(async () => remove.click())
        expect(mocks.mutate.mock.lastCall?.[0]).toEqual({
          orgId: 'org-1',
          seats: 59,
        })
        expect(add).toBeEnabled()
        await act(async () => add.click())
        const dialog = document.querySelector('[role="dialog"]')!
        if (seatPrice.interval === 'year') {
          expect(dialog.textContent).toContain('$7,320.00 per year')
          expect(dialog.textContent).toContain('Annual cost change:')
          expect(dialog.textContent).not.toContain('per month')
        } else {
          expect(dialog.textContent).toContain('$915.00 per month')
          expect(dialog.textContent).toContain('Monthly cost change:')
          expect(dialog.textContent).not.toContain('per year')
        }
        const update = [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent === copy.addSeats.confirm
        )!
        await act(async () => update.click())
        expect(mocks.mutate.mock.lastCall?.[0]).toEqual({
          orgId: 'org-1',
          seats: 61,
        })
      }
    )

    it('keeps direct checkout available while aggregate counts fail and retry', async () => {
      queryClient.removeQueries({ queryKey: organizationKeys.seats('org-1'), exact: true })
      let fail!: (error: Error) => void
      const pending = new Promise<Response>((_resolve, reject) => {
        fail = reject
      })
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).endsWith('/seats') ? pending : Response.json({ data: [] })
      )
      await render('en', <TeamManagement />)
      expect(plan()).toBeEnabled()
      expect(container.querySelector('#organization-private-tier-access-code')).not.toBeNull()
      await act(async () => {
        fail(new Error('Counts unavailable'))
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(organizationKeys.seats('org-1'))?.status).toBe('error')
        )
      })
      expect(plan()).toBeEnabled()
      expect(container.querySelector('#organization-private-tier-access-code')).not.toBeNull()
      await act(async () => plan().click())
      expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'tier-org' }), {
        organizationId: 'org-1',
      })
      vi.mocked(fetch).mockResolvedValue(Response.json({ data: counts }))
      const retry = [...container.querySelectorAll('button')].find(
        (button) =>
          button.textContent === getClientMessages('en').workspace.permissionsFeedback.retry
      )!
      await act(async () => {
        retry.click()
        await vi.waitFor(() =>
          expect(queryClient.getQueryState(organizationKeys.seats('org-1'))?.status).toBe('success')
        )
      })
    })

    it('starts checkout for the current organization while its seat counts are pending', async () => {
      await render('en', <TeamManagement />)
      mocks.organizationDetail = mocks.organization
      mocks.organization = { ...mocks.organization!, id: 'org-2', name: 'Second team' }
      mocks.billing = { ...mocks.billing, organizationId: 'org-2' }
      const pending = new Promise<Response>(() => {})
      vi.mocked(fetch).mockImplementation(async (input) =>
        String(input).endsWith('/seats') ? pending : Response.json({ data: [] })
      )
      await render('en', <TeamManagement />)
      expect(fetch).toHaveBeenCalledWith('/api/organizations/org-2/seats')
      await act(async () => plan().click())
      expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'tier-org' }), {
        organizationId: 'org-2',
      })
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

  it('bounds initial seats and preserves valid edits until the dialog closes', async () => {
    const dialog = (
      <TeamSeats
        open
        onOpenChange={vi.fn()}
        seatPrice={{ amountUsd: 10, interval: 'month' }}
        minimumSeats={4}
        maximumSeats={10}
        currentSeats={19}
        isLoading={false}
        onConfirm={mocks.mutate}
      />
    )
    const seats = () => document.querySelector<HTMLInputElement>('#seats')!
    const confirm = () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
        (button) =>
          button.textContent ===
          getClientMessages('en').workspace.settingsModal.team.addSeats.confirm
      )!

    await render('en', dialog)
    expect(seats()).toHaveValue(10)
    enterSeats(8)
    await render('en', cloneElement(dialog, { currentSeats: 29, minimumSeats: 6, maximumSeats: 9 }))
    expect(seats()).toHaveValue(8)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('$80.00 per month')
    await render('en', cloneElement(dialog, { maximumSeats: 7 }))
    expect(seats()).toHaveValue(8)
    expect(confirm()).toBeDisabled()
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('$80.00')
    await act(async () => confirm().click())
    expect(mocks.mutate).not.toHaveBeenCalled()

    await render('en', cloneElement(dialog, { seatPrice: null }))
    expect(confirm()).toBeDisabled()
    await act(async () => confirm().click())
    expect(mocks.mutate).not.toHaveBeenCalled()

    await render('en', cloneElement(dialog, { open: false }))
    await render('en', dialog)
    expect(seats()).toHaveValue(10)

    await render('en', cloneElement(dialog, { minimumSeats: 10, maximumSeats: null }))
    expect(seats()).toHaveValue(20)
    enterSeats(1)
    expect(seats()).toHaveValue(1)
    expect(confirm()).toBeDisabled()
    enterSeats(12)
    expect(seats()).toHaveValue(12)
    expect(confirm()).toBeEnabled()
    await act(async () => confirm().click())
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith(12)

    await render('en', cloneElement(dialog, { minimumSeats: 12 }))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'at most 10 seats, but 12 are required'
    )
    expect(confirm()).toBeDisabled()
    await render('en', dialog)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    enterSeats(7)
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
          seatPrice={{ amountUsd: 120, interval: 'year' }}
          minimumSeats={4}
          maximumSeats={10}
          currentSeats={2}
          isLoading={false}
          onConfirm={mocks.mutate}
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
          availableSeats={1}
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
          seatPrice={{ amountUsd: 12.5, interval: 'month' }}
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
