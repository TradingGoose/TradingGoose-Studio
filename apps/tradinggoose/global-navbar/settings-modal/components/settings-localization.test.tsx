/** @vitest-environment jsdom */

import { act, cloneElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { Organization } from '@/lib/organization'
import type { WorkspaceSettingsResponse } from '@/hooks/queries/workspace'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
import { UsageHeader } from './shared/usage-header'
import { WorkspaceBillingOwnerEditor } from './subscription/components/workspace-billing-owner'
import { MemberInvitationCard } from './team-management/components/member-invitation-card/member-invitation-card'
import { NoOrganizationView } from './team-management/components/no-organization-view/no-organization-view'
import { TeamSeatsOverview } from './team-management/components/team-seats-overview/team-seats-overview'
import { TeamManagement } from './team-management/team-management'

vi.unmock('next-intl')

const mocks = vi.hoisted(() => ({
  organization: null as Organization | null,
  billing: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  mutate: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: { user: { id: 'user-1', name: 'Ana', email: 'ana@example.com' } },
  }),
}))

vi.mock('@/lib/subscription/upgrade', () => ({
  useSubscriptionUpgrade: () => ({ handleUpgrade: mocks.mutate }),
}))

vi.mock('@/hooks/queries/organization', () => {
  const mutation = () => ({ mutationFn: mocks.mutate })
  return {
    useOrganizations: () => ({ data: { activeOrganization: mocks.organization } }),
    useOrganization: () => ({ data: mocks.organization, isLoading: false }),
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

vi.mock('@/hooks/queries/subscription', () => ({
  useSubscriptionData: () => ({ data: null, isLoading: false }),
}))

vi.mock('@/hooks/queries/public-billing-catalog', () => ({
  usePublicBillingCatalog: () => ({ data: { publicTiers: [] }, isLoading: false }),
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

vi.mock('./team-management/components', () => ({
  MemberInvitationCard: () => null,
  NoOrganizationView: ({ orgName }: { orgName: string }) => (
    <output data-testid='default-team-name'>{orgName}</output>
  ),
  RemoveMemberDialog: () => null,
  TeamMembers: () => null,
  TeamSeats: () => null,
  TeamSeatsOverview: () => null,
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
    mocks.billing = null
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    expect(onIntlError).not.toHaveBeenCalled()
  })

  async function render(locale: LocaleCode, children: ReactNode) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale={locale}
          messages={getPublicCopy(locale)}
          timeZone='UTC'
          onError={onIntlError}
        >
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </NextIntlClientProvider>
      )
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
    expect(container.textContent).toContain(role)
    expect(container.textContent).toContain(
      new Date(mocks.organization.createdAt).toLocaleDateString(locale)
    )
    expect(container.textContent).not.toContain('Organization plans')
    expect(container.textContent).not.toContain('Team ID:')
    expect(container.textContent).not.toContain('licensed seats')
  })

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
          subscriptionData={{
            id: 'subscription-1',
            status: 'active',
            seats: 2,
            referenceId: 'org-1',
            tier: {
              displayName: 'Organization Pro',
              ownerType: 'organization',
              seatMode: 'adjustable',
              monthlyPriceUsd: 12.5,
            },
          }}
          isLoadingSubscription={false}
          usedSeats={1}
          isLoading={false}
          actionsDisabled={false}
          isReducing={false}
          onConfirmTeamUpgrade={mocks.mutate}
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
