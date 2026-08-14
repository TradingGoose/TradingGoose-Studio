import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Button, Input, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'
import { formatBillingPriceLabel, formatBillingPricePeriod } from '@/lib/billing/public-catalog'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSlug, getUsedSeats, getUserRole, isAdminOrOwner } from '@/lib/organization'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import {
  organizationMutationOptions,
  useAvailableOrganizationBillingWorkspaces,
  useOrganization,
  useOrganizationBilling,
  useOrganizationBillingWorkspaces,
  useOrganizations,
} from '@/hooks/queries/organization'
import {
  getPrivateTierAccessErrorCode,
  usePrivateTierAccess,
  usePrivateTierAccessMutation,
} from '@/hooks/queries/private-tier-access'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'
import type { LocaleCode } from '@/i18n/utils'
import { toUpgradeTarget } from '../subscription/plan-configs'
import { getSubscriptionSurfaceState } from '../subscription/subscription-permissions'
import {
  MemberInvitationCard,
  NoOrganizationView,
  RemoveMemberDialog,
  TeamMembers,
  TeamSeats,
  TeamSeatsOverview,
  TeamUsage,
  WorkspaceBilling,
} from './components'

const logger = createLogger('TeamManagement')
const safeNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

type TeamSubscriptionData = {
  id: string
  billingEnabled?: boolean
  isPaid: boolean
  status: string
  seats?: number
  referenceId: string
  metadata: any
  stripeSubscriptionId: string | null
  periodEnd?: number | Date
  cancelAtPeriodEnd: boolean
  tier: BillingTierSummary | null
  usage: {
    current: number
    limit: number
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    billingPeriodStart: Date | null
    billingPeriodEnd: Date | null
    lastPeriodCost: number
    lastPeriodCopilotCost: number
    copilotCost: number
  }
  billingBlocked?: boolean
}

export function TeamManagement() {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()
  const locale = useLocale() as LocaleCode
  const privateAccessCopy = useTranslations('workspace.settingsModal.subscription.privateAccess')
  const queryClient = useQueryClient()

  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const {
    data: organization,
    isLoading,
    error: orgError,
  } = useOrganization(activeOrganization?.id || '')
  const displayOrganization = organization || activeOrganization || null
  const activeOrgId = displayOrganization?.id
  const userRole = getUserRole(displayOrganization, session?.user?.email)
  const adminOrOwner = isAdminOrOwner(displayOrganization, session?.user?.email)

  const {
    data: userSubscriptionData,
    isLoading: isLoadingPersonalSubscription,
    error: subscriptionError,
  } = useSubscriptionData()
  const {
    data: organizationBillingData,
    isLoading: isLoadingOrganizationBilling,
    isPlaceholderData: isOrganizationBillingPlaceholder,
    error: organizationBillingError,
  } = useOrganizationBilling(activeOrgId || '')
  const { data: publicBillingCatalog, isLoading: isLoadingPublicBillingCatalog } =
    usePublicBillingCatalog()
  const privateTierAccess = usePrivateTierAccess()
  const privateTierAccessMutation = usePrivateTierAccessMutation()

  const inviteMutation = useMutation(organizationMutationOptions.inviteMember(queryClient, locale))
  const removeMemberMutation = useMutation(organizationMutationOptions.removeMember(queryClient))
  const updateSeatsMutation = useMutation(organizationMutationOptions.updateSeats(queryClient))
  const createOrgMutation = useMutation(organizationMutationOptions.createOrganization(queryClient))
  const assignWorkspaceToOrganizationMutation = useMutation(
    organizationMutationOptions.assignWorkspace(queryClient)
  )
  const cancelInvitationMutation = useMutation(
    organizationMutationOptions.cancelInvitation(queryClient)
  )
  const releaseWorkspaceFromOrganizationMutation = useMutation(
    organizationMutationOptions.releaseWorkspace(queryClient)
  )
  const { data: adminWorkspaces = [], refetch: refetchAdminWorkspaces } = useAdminWorkspaces(
    session?.user?.id
  )
  const {
    data: organizationBillingWorkspaces = [],
    isLoading: isLoadingOrganizationBillingWorkspaces,
  } = useOrganizationBillingWorkspaces(activeOrgId || '', Boolean(activeOrgId && adminOrOwner))
  const {
    data: availableOrganizationBillingWorkspaces = [],
    isLoading: isLoadingAvailableOrganizationBillingWorkspaces,
  } = useAvailableOrganizationBillingWorkspaces(
    activeOrgId || '',
    Boolean(activeOrgId && adminOrOwner)
  )

  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [showWorkspaceInvite, setShowWorkspaceInvite] = useState(false)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    Array<{ workspaceId: string; permission: string }>
  >([])
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    shouldReduceSeats: boolean
    isSelfRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
  const [newSeatCount, setNewSeatCount] = useState(1)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ action: string; message: string } | null>(null)
  const actionLockRef = useRef(false)

  const isPending =
    Boolean(pendingAction) ||
    inviteMutation.isPending ||
    removeMemberMutation.isPending ||
    updateSeatsMutation.isPending ||
    createOrgMutation.isPending ||
    assignWorkspaceToOrganizationMutation.isPending ||
    cancelInvitationMutation.isPending ||
    releaseWorkspaceFromOrganizationMutation.isPending

  const runAction = useCallback(
    async (action: string, operation: () => Promise<unknown>) => {
      if (actionLockRef.current || isPending) return false

      actionLockRef.current = true
      setPendingAction(action)
      setActionError(null)
      try {
        await operation()
        return true
      } catch (cause) {
        const failure = cause instanceof Error ? cause.message : 'The organization action failed'
        logger.error('Organization action failed', { action, error: cause })
        setActionError({ action, message: failure })
        return false
      } finally {
        actionLockRef.current = false
        setPendingAction(null)
      }
    },
    [isPending]
  )

  const personalBillingPayload = (userSubscriptionData as any)?.data ?? userSubscriptionData
  const organizationBillingPayload =
    organizationBillingData?.organizationId === activeOrgId ? organizationBillingData : null
  const organizationBillingPending =
    isLoadingOrganizationBilling || Boolean(activeOrgId && isOrganizationBillingPlaceholder)
  const organizationSubscriptionTier = organizationBillingPayload?.subscriptionTier ?? null
  const organizationSubscriptionData: TeamSubscriptionData | null = organizationBillingPayload
    ? {
        id: organizationBillingPayload.organizationId,
        billingEnabled: organizationBillingPayload.billingEnabled,
        isPaid: Boolean(organizationSubscriptionTier),
        status: organizationBillingPayload.subscriptionStatus,
        seats: organizationBillingPayload.totalSeats,
        referenceId: organizationBillingPayload.organizationId,
        metadata: null,
        stripeSubscriptionId: null,
        periodEnd: organizationBillingPayload.billingPeriodEnd
          ? new Date(organizationBillingPayload.billingPeriodEnd)
          : undefined,
        cancelAtPeriodEnd: false,
        tier: organizationSubscriptionTier,
        usage: {
          current: organizationBillingPayload.totalCurrentUsage,
          limit: organizationBillingPayload.totalUsageLimit,
          percentUsed:
            organizationBillingPayload.totalUsageLimit > 0
              ? (organizationBillingPayload.totalCurrentUsage /
                  organizationBillingPayload.totalUsageLimit) *
                100
              : 0,
          isWarning:
            organizationBillingPayload.totalUsageLimit > 0 &&
            (organizationBillingPayload.totalCurrentUsage /
              organizationBillingPayload.totalUsageLimit) *
              100 >=
              organizationBillingPayload.warningThresholdPercent,
          isExceeded:
            organizationBillingPayload.totalUsageLimit > 0 &&
            organizationBillingPayload.totalCurrentUsage >=
              organizationBillingPayload.totalUsageLimit,
          billingPeriodStart: organizationBillingPayload.billingPeriodStart
            ? new Date(organizationBillingPayload.billingPeriodStart)
            : null,
          billingPeriodEnd: organizationBillingPayload.billingPeriodEnd
            ? new Date(organizationBillingPayload.billingPeriodEnd)
            : null,
          lastPeriodCost: organizationBillingPayload.lastPeriodCost ?? 0,
          lastPeriodCopilotCost: organizationBillingPayload.lastPeriodCopilotCost ?? 0,
          copilotCost: organizationBillingPayload.currentPeriodCopilotCost ?? 0,
        },
        billingBlocked: organizationBillingPayload.billingBlocked,
      }
    : null
  const billingPayload = displayOrganization ? organizationSubscriptionData : personalBillingPayload
  const subscriptionData = billingPayload as TeamSubscriptionData | null
  const currentTier = subscriptionData?.tier ?? null
  const billingEnabled =
    organizationBillingPayload?.billingEnabled ??
    personalBillingPayload?.billingEnabled ??
    organizationsData?.billingData?.data?.billingEnabled ??
    true
  const availableOrganizationTiers = [
    ...(publicBillingCatalog?.publicTiers ?? []),
    ...(privateTierAccess.data?.privateTiers ?? []),
  ].sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id))
  const organizationPlanSurface = getSubscriptionSurfaceState({
    subscription: {
      isFree: false,
      isPaid: Boolean(organizationSubscriptionTier),
      tier:
        organizationSubscriptionTier ??
        ({
          ...EMPTY_BILLING_TIER_SUMMARY,
          ownerType: 'organization',
          usageScope: 'pooled',
        } satisfies BillingTierSummary),
    },
    userRole: { isTeamAdmin: adminOrOwner },
    publicTiers: availableOrganizationTiers,
    enterprisePlaceholder: publicBillingCatalog?.enterprisePlaceholder ?? null,
  })
  const organizationPlanTiers = organizationPlanSurface.visiblePlanTiers
  const organizationAccess = getOrganizationAccessState({
    billingEnabled,
    hasOrganization: Boolean(displayOrganization),
    isOrganizationAdmin: adminOrOwner,
    organizationTier: organizationSubscriptionTier,
  })
  const isLoadingSubscription = displayOrganization
    ? organizationBillingPending
    : isLoadingPersonalSubscription
  const isAdjustableSeatTier =
    currentTier?.ownerType === 'organization' && currentTier.seatMode === 'adjustable'
  const adjustableSeatTier =
    publicBillingCatalog?.publicTiers.find(
      (tier) => tier.ownerType === 'organization' && tier.seatMode === 'adjustable'
    ) ?? null
  const seatPriceUsd =
    safeNumber(currentTier?.monthlyPriceUsd) || safeNumber(adjustableSeatTier?.monthlyPriceUsd)
  const seatCount = currentTier?.seatCount ?? adjustableSeatTier?.seatCount ?? 1
  const seatMaximum = currentTier?.seatMaximum ?? adjustableSeatTier?.seatMaximum ?? null
  const organizationPlanCatalogPending =
    isLoadingPublicBillingCatalog || privateTierAccess.isLoading
  const canShowOrganizationPlans = Boolean(
    billingEnabled &&
      adminOrOwner &&
      !organizationBillingPending &&
      !organizationBillingError &&
      !organizationPlanCatalogPending &&
      organizationBillingPayload
  )
  const showOrganizationBillingError = Boolean(
    billingEnabled && adminOrOwner && !organizationBillingPending && organizationBillingError
  )

  const usedSeats = getUsedSeats(displayOrganization)
  const canInviteMembers = Boolean(currentTier?.ownerType === 'organization')
  const seatLimited = canInviteMembers
  const inviteUnavailableMessage =
    displayOrganization && !canInviteMembers
      ? 'An active organization subscription is required before you can invite team members.'
      : null

  useEffect(() => {
    if (session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [session?.user?.name, orgName])

  useEffect(() => {
    if (session?.user?.id && activeOrgId && adminOrOwner) {
      void refetchAdminWorkspaces()
    }
  }, [session?.user?.id, activeOrgId, adminOrOwner, refetchAdminWorkspaces])

  const handleOrgNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setOrgName(newName)
    setOrgSlug(generateSlug(newName))
  }, [])

  const handleCreateOrganization = useCallback(async () => {
    if (!session?.user || !orgName.trim()) return

    const succeeded = await runAction('create', () =>
      createOrgMutation.mutateAsync({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      })
    )
    if (succeeded) {
      setOrgName('')
      setOrgSlug('')
    }
  }, [session?.user?.id, orgName, orgSlug, createOrgMutation, runAction])

  const handleInviteMember = useCallback(async () => {
    if (!session?.user || !activeOrgId || !inviteEmail.trim()) return

    const workspaceInvitations =
      selectedWorkspaces.length > 0
        ? selectedWorkspaces.map((w) => ({
            workspaceId: w.workspaceId,
            permission: w.permission as 'admin' | 'write' | 'read',
          }))
        : undefined
    const succeeded = await runAction('invite', () =>
      inviteMutation.mutateAsync({
        email: inviteEmail.trim(),
        orgId: activeOrgId,
        workspaceInvitations,
      })
    )
    if (succeeded) {
      setInviteSuccess(true)
      setTimeout(() => setInviteSuccess(false), 3000)
      setInviteEmail('')
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
    }
  }, [session?.user?.id, activeOrgId, inviteEmail, selectedWorkspaces, inviteMutation, runAction])

  const handleWorkspaceToggle = useCallback((workspaceId: string, permission: string) => {
    setSelectedWorkspaces((prev) => {
      const exists = prev.find((w) => w.workspaceId === workspaceId)

      if (!permission || permission === '') {
        return prev.filter((w) => w.workspaceId !== workspaceId)
      }

      if (exists) {
        return prev.map((w) => (w.workspaceId === workspaceId ? { ...w, permission } : w))
      }

      return [...prev, { workspaceId, permission }]
    })
  }, [])

  const handleRemoveMember = useCallback(
    async (member: any) => {
      if (!session?.user || !activeOrgId) return

      if (!member.user?.id) {
        logger.error('Member object missing user ID', { member })
        return
      }

      const isLeavingSelf = member.user?.email === session.user.email
      const displayName = isLeavingSelf
        ? 'yourself'
        : member.user?.name || member.user?.email || 'this member'

      setRemoveMemberDialog({
        open: true,
        memberId: member.user.id,
        memberName: displayName,
        shouldReduceSeats: false,
        isSelfRemoval: isLeavingSelf,
      })
    },
    [session?.user, activeOrgId]
  )

  const confirmRemoveMember = useCallback(
    async (shouldReduceSeats = false) => {
      const { memberId } = removeMemberDialog
      if (!session?.user || !activeOrgId || !memberId) return

      const succeeded = await runAction('remove', () =>
        removeMemberMutation.mutateAsync({
          memberId,
          orgId: activeOrgId,
          shouldReduceSeats,
        })
      )
      if (succeeded) {
        setRemoveMemberDialog({
          open: false,
          memberId: '',
          memberName: '',
          shouldReduceSeats: false,
        })
      }
    },
    [removeMemberDialog.memberId, session?.user?.id, activeOrgId, removeMemberMutation, runAction]
  )

  const handleReduceSeats = useCallback(async () => {
    if (!session?.user || !activeOrgId || !subscriptionData) return
    if (
      subscriptionData.tier?.ownerType !== 'organization' ||
      subscriptionData.tier?.seatMode !== 'adjustable'
    ) {
      return
    }

    const currentSeats = subscriptionData.seats || 0
    if (currentSeats <= 1) return

    if (usedSeats.used >= currentSeats) return

    await runAction('reduce-seats', () =>
      updateSeatsMutation.mutateAsync({
        orgId: activeOrgId,
        seats: currentSeats - 1,
      })
    )
  }, [
    session?.user?.id,
    activeOrgId,
    subscriptionData,
    usedSeats.used,
    updateSeatsMutation,
    runAction,
  ])

  const handleAddSeatDialog = useCallback(() => {
    if (
      subscriptionData &&
      subscriptionData.tier?.ownerType === 'organization' &&
      subscriptionData.tier?.seatMode === 'adjustable'
    ) {
      setNewSeatCount((subscriptionData.seats || 1) + 1)
      setIsAddSeatDialogOpen(true)
    }
  }, [subscriptionData])

  const confirmAddSeats = useCallback(
    async (selectedSeats?: number) => {
      if (
        !subscriptionData ||
        !activeOrgId ||
        subscriptionData.tier?.ownerType !== 'organization' ||
        subscriptionData.tier?.seatMode !== 'adjustable'
      ) {
        return
      }

      const seatsToUse = selectedSeats || newSeatCount
      const succeeded = await runAction('update-seats', () =>
        updateSeatsMutation.mutateAsync({
          orgId: activeOrgId,
          seats: seatsToUse,
        })
      )
      if (succeeded) {
        setIsAddSeatDialogOpen(false)
      }
    },
    [subscriptionData, activeOrgId, newSeatCount, updateSeatsMutation, runAction]
  )

  const handleAssignWorkspaceBilling = useCallback(
    async (workspaceId: string) => {
      if (!activeOrgId) {
        return
      }

      await runAction(`assign:${workspaceId}`, () =>
        assignWorkspaceToOrganizationMutation.mutateAsync({
          organizationId: activeOrgId,
          workspaceId,
        })
      )
    },
    [activeOrgId, assignWorkspaceToOrganizationMutation, runAction]
  )

  const handleReleaseWorkspaceBilling = useCallback(
    async (workspaceId: string) => {
      if (!activeOrgId) {
        return
      }

      await runAction(`release:${workspaceId}`, () =>
        releaseWorkspaceFromOrganizationMutation.mutateAsync({
          organizationId: activeOrgId,
          workspaceId,
        })
      )
    },
    [activeOrgId, releaseWorkspaceFromOrganizationMutation, runAction]
  )

  const confirmTeamUpgrade = useCallback(
    async (seats: number) => {
      if (!session?.user || !adjustableSeatTier) {
        alert('No public adjustable organization tier is configured')
        return
      }

      logger.info('Organization tier upgrade requested', {
        seats,
        organizationId: activeOrgId,
        billingTier: adjustableSeatTier.displayName,
      })

      await handleUpgrade(
        {
          billingTierId: adjustableSeatTier.id,
          displayName: adjustableSeatTier.displayName,
          ownerType: adjustableSeatTier.ownerType,
          usageScope: adjustableSeatTier.usageScope,
          seatMode: adjustableSeatTier.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
          seatCount: adjustableSeatTier.seatCount,
        },
        {
          seats,
          organizationId: activeOrgId,
        }
      )
    },
    [session?.user, activeOrgId, adjustableSeatTier, handleUpgrade]
  )

  const queryError = orgError || organizationBillingError || subscriptionError
  const queryFailure = queryError instanceof Error ? queryError.message : null
  const actionFailure = (action: string) =>
    actionError?.action === action ? actionError.message : null
  const privateAccessErrorCode =
    getPrivateTierAccessErrorCode(privateTierAccessMutation.error) ??
    (privateTierAccessMutation.isError ? PRIVATE_TIER_ACCESS_ERROR_CODES.validateFailed : null) ??
    getPrivateTierAccessErrorCode(privateTierAccess.error) ??
    (privateTierAccess.isError ? PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed : null)
  const handlePrivateTierAccess = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    privateTierAccessMutation.mutate(accessCode.trim(), {
      onSuccess: () => setAccessCode(''),
    })
  }

  if (isLoading && !displayOrganization) {
    return (
      <div className='px-6 pt-4 pb-4'>
        <div className='space-y-4'>
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-4 w-3/4' />
        </div>
      </div>
    )
  }

  if (!displayOrganization) {
    return (
      <NoOrganizationView
        canCreateOrganization={organizationAccess.canCreateOrganization}
        orgName={orgName}
        orgSlug={orgSlug}
        setOrgSlug={setOrgSlug}
        onOrgNameChange={handleOrgNameChange}
        onCreateOrganization={handleCreateOrganization}
        isCreatingOrg={createOrgMutation.isPending}
        error={queryFailure || actionFailure('create')}
      />
    )
  }

  return (
    <div className='flex h-full flex-col px-6 pt-4 pb-4'>
      <div className='flex flex-1 flex-col gap-6 overflow-y-auto'>
        {/* Team Usage Overview */}
        <TeamUsage hasAdminAccess={adminOrOwner} />

        {/* Organization billing information */}
        {currentTier?.ownerType === 'organization' && (
          <div className='rounded-sm border bg-blue-50/50 p-4 shadow-xs dark:bg-blue-950/20'>
            <div className='space-y-3'>
              <h4 className='font-medium text-sm'>How this team billing works</h4>
              <ul className='ml-4 list-disc space-y-2 text-muted-foreground text-xs'>
                <li>
                  Your team is billed a minimum of ${(subscriptionData?.seats || 0) * seatPriceUsd}
                  /month for {subscriptionData?.seats || 0} licensed seats
                </li>
                <li>Usage is tracked against the active included allowance for this tier</li>
                <li>You can increase the usage limit to allow for higher usage</li>
                <li>
                  Any usage beyond the minimum seat cost is billed as overage at the end of the
                  billing period
                </li>
              </ul>
            </div>
          </div>
        )}

        {canShowOrganizationPlans ? (
          <div className='space-y-3 rounded-sm border bg-background p-4 shadow-xs'>
            <div>
              <h4 className='font-medium text-sm'>Organization plans</h4>
              <p className='mt-1 text-muted-foreground text-xs'>
                {currentTier
                  ? 'Review the current plan or change to another available organization tier.'
                  : 'Subscribe this organization before assigning workspace billing or inviting members.'}
              </p>
            </div>

            <form className='flex gap-2' onSubmit={handlePrivateTierAccess}>
              <Input
                className='min-w-0 flex-1'
                value={accessCode}
                placeholder={privateAccessCopy('placeholder')}
                autoComplete='off'
                onChange={(event) => {
                  setAccessCode(event.target.value)
                  privateTierAccessMutation.reset()
                }}
              />
              <Button
                type='submit'
                disabled={!accessCode.trim() || privateTierAccessMutation.isPending}
              >
                {privateAccessCopy('validate')}
              </Button>
            </form>
            {privateAccessErrorCode ? (
              <p role='alert' className='text-destructive text-xs'>
                {privateAccessCopy(`errors.${privateAccessErrorCode}`)}
              </p>
            ) : privateTierAccessMutation.isSuccess ? (
              <p role='status' className='text-muted-foreground text-xs'>
                {privateAccessCopy('success')}
              </p>
            ) : null}

            {organizationPlanTiers.length > 0 ? (
              <div className='flex flex-wrap gap-2'>
                {organizationPlanTiers.map((tier) => {
                  const isCurrentTier = tier.id === organizationPlanSurface.currentTier?.id

                  return (
                    <Button
                      key={tier.id}
                      variant='outline'
                      disabled={isCurrentTier || isPending || !activeOrgId}
                      onClick={() => {
                        if (isCurrentTier) return

                        void runAction(`subscribe:${tier.id}`, () =>
                          handleUpgrade(toUpgradeTarget(tier), {
                            organizationId: activeOrgId,
                            seats: Math.max(tier.seatCount ?? 1, 1),
                          })
                        )
                      }}
                    >
                      {tier.displayName} · {formatBillingPriceLabel(tier)}
                      {formatBillingPricePeriod(tier)}
                      {isCurrentTier ? ' · Current' : null}
                    </Button>
                  )
                })}
              </div>
            ) : privateTierAccess.isError ? null : (
              <p className='text-muted-foreground text-xs'>
                No organization plans are currently available.
              </p>
            )}
            {actionError?.action.startsWith('subscribe:') ? (
              <p role='alert' className='text-destructive text-xs'>
                {actionError.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {showOrganizationBillingError ? (
          <p role='alert' className='text-destructive text-xs'>
            Failed to load organization billing. Try again before selecting a plan.
          </p>
        ) : null}

        <WorkspaceBilling
          billedWorkspaces={organizationBillingWorkspaces}
          availableWorkspaces={availableOrganizationBillingWorkspaces}
          canManage={adminOrOwner}
          hasOrganizationBilling={Boolean(currentTier?.ownerType === 'organization')}
          isLoading={
            isLoadingOrganizationBillingWorkspaces ||
            isLoadingAvailableOrganizationBillingWorkspaces
          }
          isPending={isPending}
          pendingAction={pendingAction}
          error={
            pendingAction?.startsWith('assign:') || pendingAction?.startsWith('release:')
              ? null
              : actionError?.action.startsWith('assign:') ||
                  actionError?.action.startsWith('release:')
                ? actionError.message
                : null
          }
          onAssignWorkspace={handleAssignWorkspaceBilling}
          onReleaseWorkspace={handleReleaseWorkspaceBilling}
        />

        {/* Team Seats Overview */}
        {adminOrOwner && isAdjustableSeatTier && (
          <TeamSeatsOverview
            subscriptionData={subscriptionData}
            isLoadingSubscription={isLoadingSubscription}
            usedSeats={usedSeats.used}
            isLoading={isLoading}
            actionsDisabled={isPending}
            isReducing={pendingAction === 'reduce-seats'}
            error={actionFailure('reduce-seats')}
            onConfirmTeamUpgrade={confirmTeamUpgrade}
            onReduceSeats={handleReduceSeats}
            onAddSeatDialog={handleAddSeatDialog}
          />
        )}

        {/* Team Members */}
        <TeamMembers
          organization={displayOrganization}
          currentUserEmail={session?.user?.email ?? ''}
          isAdminOrOwner={adminOrOwner}
          actionsDisabled={isPending}
          pendingInvitationId={
            pendingAction?.startsWith('cancel:') ? pendingAction.slice('cancel:'.length) : null
          }
          error={actionError?.action.startsWith('cancel:') ? actionError.message : null}
          onRemoveMember={handleRemoveMember}
          onCancelInvitation={async (invitationId: string) => {
            if (!displayOrganization?.id) return
            await runAction(`cancel:${invitationId}`, () =>
              cancelInvitationMutation.mutateAsync({
                invitationId,
                orgId: displayOrganization.id,
              })
            )
          }}
        />

        {/* Single Organization Notice */}
        {adminOrOwner && (
          <div className='mt-4 rounded-lg bg-muted/50 p-3'>
            <p className='text-muted-foreground text-xs'>
              <span className='font-medium'>Note:</span> Users can only be part of one organization
              at a time. They must leave their current organization before joining another.
            </p>
          </div>
        )}

        {/* Member Invitation Card */}
        {adminOrOwner && (
          <MemberInvitationCard
            inviteEmail={inviteEmail}
            setInviteEmail={setInviteEmail}
            isInviting={inviteMutation.isPending}
            actionsDisabled={isPending}
            error={actionFailure('invite')}
            showWorkspaceInvite={showWorkspaceInvite}
            setShowWorkspaceInvite={setShowWorkspaceInvite}
            selectedWorkspaces={selectedWorkspaces}
            userWorkspaces={adminWorkspaces}
            onInviteMember={handleInviteMember}
            onLoadUserWorkspaces={async () => {
              await refetchAdminWorkspaces()
            }}
            onWorkspaceToggle={handleWorkspaceToggle}
            inviteSuccess={inviteSuccess}
            canInviteMembers={canInviteMembers}
            inviteUnavailableMessage={inviteUnavailableMessage}
            seatLimited={seatLimited}
            availableSeats={Math.max(0, (subscriptionData?.seats || 0) - usedSeats.used)}
          />
        )}
      </div>

      {/* Team Information Section - pinned to bottom of modal */}
      <div className='mt-6 flex-shrink-0 border-t pt-6'>
        <div className='space-y-3 text-xs'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Team ID:</span>
            <span className='font-mono'>{displayOrganization.id}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Created:</span>
            <span>{new Date(displayOrganization.createdAt).toLocaleDateString()}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>Your Role:</span>
            <span className='font-medium capitalize'>{userRole}</span>
          </div>
        </div>
      </div>

      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        shouldReduceSeats={removeMemberDialog.shouldReduceSeats}
        canReduceSeats={isAdjustableSeatTier}
        isSelfRemoval={removeMemberDialog.isSelfRemoval}
        isPending={pendingAction === 'remove' || removeMemberMutation.isPending}
        error={actionFailure('remove')}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setRemoveMemberDialog((prev) => (prev.open ? { ...prev, open: false } : prev))
          }
        }}
        onShouldReduceSeatsChange={(shouldReduce: boolean) =>
          setRemoveMemberDialog((prev) =>
            prev.shouldReduceSeats === shouldReduce
              ? prev
              : { ...prev, shouldReduceSeats: shouldReduce }
          )
        }
        onConfirmRemove={(shouldReduceSeats: boolean) =>
          confirmRemoveMember(isAdjustableSeatTier ? shouldReduceSeats : false)
        }
        onCancel={() =>
          setRemoveMemberDialog({
            open: false,
            memberId: '',
            memberName: '',
            shouldReduceSeats: false,
            isSelfRemoval: false,
          })
        }
      />

      <TeamSeats
        open={isAddSeatDialogOpen && isAdjustableSeatTier}
        onOpenChange={setIsAddSeatDialogOpen}
        title='Add Team Seats'
        description={`Each seat costs $${seatPriceUsd}/month and provides $${seatPriceUsd} in monthly inference credits. Adjust the number of licensed seats for your team.`}
        pricePerSeat={seatPriceUsd}
        minimumSeats={seatCount}
        maximumSeats={seatMaximum}
        currentSeats={subscriptionData?.seats || 1}
        initialSeats={newSeatCount}
        isLoading={
          pendingAction === 'update-seats' || (isAddSeatDialogOpen && updateSeatsMutation.isPending)
        }
        error={actionFailure('update-seats')}
        onConfirm={async (selectedSeats: number) => {
          setNewSeatCount(selectedSeats)
          await confirmAddSeats(selectedSeats)
        }}
        confirmButtonText='Update Seats'
        showCostBreakdown={true}
        isCancelledAtPeriodEnd={subscriptionData?.cancelAtPeriodEnd}
      />
    </div>
  )
}
