import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Button, Input, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { getCatalogPriceForInterval } from '@/lib/billing/public-catalog'
import { EMPTY_BILLING_TIER_SUMMARY } from '@/lib/billing/tier-summary'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSlug, getUserRole } from '@/lib/organization'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUpgradeTierIssue, useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import {
  organizationMutationOptions,
  useAvailableOrganizationBillingWorkspaces,
  useOrganization,
  useOrganizationBilling,
  useOrganizationBillingWorkspaces,
  useOrganizationSeats,
  useOrganizations,
} from '@/hooks/queries/organization'
import { usePrivateTierAccessForm } from '@/hooks/queries/private-tier-access'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'
import { formatUsd } from '@/i18n/formatters'
import type { LocaleCode } from '@/i18n/utils'
import {
  getSubscriptionSurfaceState,
  mergeAccessibleBillingTiers,
} from '../subscription/subscription-permissions'
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

export function TeamManagement() {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()
  const locale = useLocale() as LocaleCode
  const copy = useTranslations('workspace.settingsModal.team')
  const retryCopy = useTranslations('workspace.permissionsFeedback')
  const roles = useTranslations('workspace.switcher.roles')
  const privateAccessCopy = useTranslations('workspace.settingsModal.subscription.privateAccess')
  const queryClient = useQueryClient()

  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const activeOrgId = activeOrganization?.id
  const { data: organization, isLoading, error: orgError } = useOrganization(activeOrgId || '')
  const displayOrganization = organization?.id === activeOrgId ? organization : activeOrganization
  const userRole = getUserRole(displayOrganization, session?.user?.email)
  const adminOrOwner = userRole === 'owner' || userRole === 'admin'
  const isOrganizationOwner = userRole === 'owner'

  const {
    data: organizationBillingData,
    isLoading: isLoadingOrganizationBilling,
    isPlaceholderData: isOrganizationBillingPlaceholder,
    error: organizationBillingError,
  } = useOrganizationBilling(activeOrgId || '')
  const { data: publicBillingCatalog, isLoading: isLoadingPublicBillingCatalog } =
    usePublicBillingCatalog()
  const {
    accessCode,
    errorCode: privateAccessErrorCode,
    mutation: privateTierAccessMutation,
    onChange: onPrivateTierAccessCodeChange,
    onSubmit: handlePrivateTierAccess,
    query: privateTierAccess,
  } = usePrivateTierAccessForm()

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

  const [invitedWorkspaceCount, setInvitedWorkspaceCount] = useState<number | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [showWorkspaceInvite, setShowWorkspaceInvite] = useState(false)
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    Array<{ workspaceId: string; permission: string }>
  >([])
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    isSelfRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '' })
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
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
        logger.error('Organization action failed', { action, error: cause })
        setActionError({ action, message: copy('errors.actionFailed') })
        return false
      } finally {
        actionLockRef.current = false
        setPendingAction(null)
      }
    },
    [isPending, copy]
  )

  const organizationBillingPayload =
    organizationBillingData?.organizationId === activeOrgId ? organizationBillingData : null
  const organizationBillingPending =
    isLoadingOrganizationBilling || Boolean(activeOrgId && isOrganizationBillingPlaceholder)
  const currentTier = organizationBillingPayload?.subscriptionTier ?? null
  const billingEnabled =
    organizationBillingPayload?.billingEnabled ??
    organizationsData?.billingData?.data?.billingEnabled ??
    true
  const seatCountsEnabled = organizationBillingPayload?.billingEnabled === true
  const {
    data: seatCounts,
    isPending: isSeatCountsPending,
    isError: isSeatCountsError,
    isFetching: isSeatCountsFetching,
    refetch: refetchSeatCounts,
  } = useOrganizationSeats(activeOrgId || '', seatCountsEnabled)
  const organizationSeats = seatCounts?.organizationId === activeOrgId ? seatCounts : undefined
  const totalSeats = organizationSeats?.maxSeats ?? 0
  const seatCountsUnavailable = isSeatCountsPending || isSeatCountsError || !organizationSeats
  const usedSeats = organizationSeats?.usedSeats ?? 0
  const availableOrganizationTiers = mergeAccessibleBillingTiers(
    publicBillingCatalog?.publicTiers,
    privateTierAccess.data?.privateTiers
  )
  const organizationPlanSurface = getSubscriptionSurfaceState({
    subscription: {
      isFree: false,
      isPaid: Boolean(currentTier),
      tier:
        currentTier ??
        ({
          ...EMPTY_BILLING_TIER_SUMMARY,
          ownerType: 'organization',
          usageScope: 'pooled',
        } satisfies BillingTierSummary),
    },
    userRole: { isOrganizationOwner },
    publicTiers: availableOrganizationTiers,
    enterprisePlaceholder: publicBillingCatalog?.enterprisePlaceholder ?? null,
  })
  const organizationPlanTiers = organizationPlanSurface.visiblePlanTiers
  const organizationAccess = getOrganizationAccessState({
    billingEnabled,
    hasOrganization: Boolean(displayOrganization),
    isOrganizationAdmin: adminOrOwner,
    organizationTier: currentTier,
  })
  const isAdjustableSeatTier =
    currentTier?.ownerType === 'organization' && currentTier.seatMode === 'adjustable'
  const seatPrice = organizationSeats?.seatPrice
  const seatCount = currentTier?.seatCount ?? 1
  const seatMaximum = currentTier?.seatMaximum ?? null
  const organizationPlanCatalogPending =
    isLoadingPublicBillingCatalog || privateTierAccess.isLoading
  const canShowOrganizationPlans = Boolean(
    billingEnabled &&
      isOrganizationOwner &&
      !organizationBillingPending &&
      !organizationBillingError &&
      !organizationPlanCatalogPending &&
      organizationBillingPayload
  )
  const showOrganizationBillingError = Boolean(
    billingEnabled && adminOrOwner && !organizationBillingPending && organizationBillingError
  )
  const showSeatCountsError = seatCountsEnabled && isSeatCountsError

  const canInviteMembers = Boolean(currentTier?.ownerType === 'organization')
  const inviteUnavailableMessage =
    displayOrganization && !canInviteMembers ? copy('inviteUnavailableMessage') : null

  useEffect(() => {
    setIsAddSeatDialogOpen(false)
  }, [activeOrgId])

  useEffect(() => {
    if (session?.user?.name && !orgName) {
      const defaultName = copy('defaultTeamName', { name: session.user.name })
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName) || 'team')
    }
  }, [session?.user?.name, orgName, copy])

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
    if (!session?.user || !activeOrgId || !inviteEmail.trim() || seatCountsUnavailable) return

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
      setInvitedWorkspaceCount(workspaceInvitations?.length ?? 0)
      setTimeout(() => setInvitedWorkspaceCount(null), 3000)
      setInviteEmail('')
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
    }
  }, [
    session?.user?.id,
    activeOrgId,
    inviteEmail,
    selectedWorkspaces,
    inviteMutation,
    runAction,
    seatCountsUnavailable,
  ])

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
        ? copy('yourself')
        : member.user?.name || member.user?.email || copy('thisMember')

      setRemoveMemberDialog({
        open: true,
        memberId: member.user.id,
        memberName: displayName,
        isSelfRemoval: isLeavingSelf,
      })
    },
    [session?.user, activeOrgId, copy]
  )

  const confirmRemoveMember = useCallback(async () => {
    const { memberId } = removeMemberDialog
    if (!session?.user || !activeOrgId || !memberId) return

    const succeeded = await runAction('remove', () =>
      removeMemberMutation.mutateAsync({
        memberId,
        orgId: activeOrgId,
      })
    )
    if (succeeded) {
      setRemoveMemberDialog({
        open: false,
        memberId: '',
        memberName: '',
      })
    }
  }, [removeMemberDialog.memberId, session?.user?.id, activeOrgId, removeMemberMutation, runAction])

  const handleReduceSeats = useCallback(async () => {
    if (!activeOrgId || totalSeats <= 1 || usedSeats >= totalSeats) return

    await runAction('reduce-seats', () =>
      updateSeatsMutation.mutateAsync({
        orgId: activeOrgId,
        seats: totalSeats - 1,
      })
    )
  }, [activeOrgId, totalSeats, usedSeats, updateSeatsMutation, runAction])

  const confirmAddSeats = useCallback(
    async (selectedSeats: number) => {
      if (!activeOrgId) return

      const succeeded = await runAction('update-seats', () =>
        updateSeatsMutation.mutateAsync({
          orgId: activeOrgId,
          seats: selectedSeats,
        })
      )
      if (succeeded) {
        setIsAddSeatDialogOpen(false)
      }
    },
    [activeOrgId, updateSeatsMutation, runAction]
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

  const queryError = orgError || organizationBillingError
  const queryFailure = queryError ? copy('errors.loadFailed') : null
  const actionFailure = (action: string) =>
    actionError?.action === action ? actionError.message : null
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
        <TeamUsage isOrganizationOwner={isOrganizationOwner} />

        {/* Organization billing information */}
        {currentTier?.ownerType === 'organization' && (
          <div className='rounded-sm border bg-blue-50/50 p-4 shadow-xs dark:bg-blue-950/20'>
            <div className='space-y-3'>
              <h4 className='font-medium text-sm'>{copy('howBillingWorks')}</h4>
              <ul className='ml-4 list-disc space-y-2 text-muted-foreground text-xs'>
                {seatPrice && (
                  <li>
                    {copy('billingHowWorksSeatCost', {
                      seats: totalSeats,
                      amount: formatUsd(locale, totalSeats * seatPrice.amountUsd),
                      interval: seatPrice.interval,
                    })}
                  </li>
                )}
                <li>{copy('billingHowWorksUsageTracked')}</li>
                <li>{copy('billingHowWorksIncreaseLimit')}</li>
                <li>{copy('billingHowWorksOverage')}</li>
              </ul>
            </div>
          </div>
        )}

        {canShowOrganizationPlans ? (
          <div className='space-y-3 rounded-sm border bg-background p-4 shadow-xs'>
            <div>
              <h4 className='font-medium text-sm'>{copy('plans.title')}</h4>
              <p className='mt-1 text-muted-foreground text-xs'>{copy('plans.description')}</p>
            </div>

            <label htmlFor='organization-private-tier-access-code' className='font-medium text-sm'>
              {privateAccessCopy('label')}
            </label>
            <form className='flex gap-2' onSubmit={handlePrivateTierAccess}>
              <Input
                id='organization-private-tier-access-code'
                className='min-w-0 flex-1'
                value={accessCode}
                placeholder={privateAccessCopy('placeholder')}
                autoComplete='off'
                onChange={(event) => onPrivateTierAccessCodeChange(event.target.value)}
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
                  const issue = isCurrentTier
                    ? null
                    : getUpgradeTierIssue(tier, seatCountsUnavailable ? 0 : usedSeats)
                  const interval = isCurrentTier
                    ? organizationBillingPayload?.billingInterval
                    : tier.hasStripeMonthlyPriceId
                      ? 'month'
                      : null
                  const price = getCatalogPriceForInterval(tier, interval)
                  const planLabel = (
                    <>
                      {tier.displayName}
                      {price !== null && (
                        <>
                          {' '}
                          · {formatUsd(locale, price)}
                          {interval === 'year' ? copy('plans.yearly') : copy('plans.monthly')}
                        </>
                      )}
                      {isCurrentTier ? ` · ${copy('plans.current')}` : null}
                    </>
                  )

                  return isCurrentTier ? (
                    <div
                      key={tier.id}
                      aria-current='true'
                      className='inline-flex h-10 items-center justify-center rounded-md border border-primary bg-primary/10 px-4 py-2 font-medium text-primary text-sm'
                    >
                      {planLabel}
                    </div>
                  ) : (
                    <div key={tier.id} className='max-w-xs'>
                      <Button
                        variant='outline'
                        disabled={
                          isPending ||
                          issue !== null ||
                          !activeOrgId ||
                          !organizationPlanSurface.canManageOrganizationPlan
                        }
                        onClick={() => {
                          if (issue) return
                          void runAction(`subscribe:${tier.id}`, () =>
                            handleUpgrade(tier, { organizationId: activeOrgId })
                          )
                        }}
                      >
                        {planLabel}
                      </Button>
                      {issue === 'capacity' && (
                        <p className='mt-1 text-muted-foreground text-xs'>
                          {copy('seatCapacityConflict', {
                            minimum: Math.max(tier.seatCount ?? 1, usedSeats),
                            maximum:
                              tier.seatMode === 'fixed'
                                ? (tier.seatCount ?? 1)
                                : (tier.seatMaximum ?? 1),
                          })}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : privateTierAccess.isError ? null : (
              <p className='text-muted-foreground text-xs'>{copy('plans.empty')}</p>
            )}
            {actionError?.action.startsWith('subscribe:') ? (
              <p role='alert' className='text-destructive text-xs'>
                {actionError.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {showOrganizationBillingError || showSeatCountsError ? (
          <div role='alert' className='flex items-center gap-2 text-destructive text-xs'>
            <p>{copy('errors.loadOrganizationBilling')}</p>
            {showSeatCountsError && (
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={isSeatCountsFetching}
                onClick={() => void refetchSeatCounts()}
              >
                {retryCopy('retry')}
              </Button>
            )}
          </div>
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
        {isOrganizationOwner && isAdjustableSeatTier && (
          <TeamSeatsOverview
            totalSeats={totalSeats}
            pricePerSeat={seatPrice?.amountUsd ?? null}
            billingInterval={seatPrice?.interval ?? null}
            isLoadingSubscription={organizationBillingPending || seatCountsUnavailable}
            usedSeats={usedSeats}
            actionsDisabled={isLoading || isPending}
            isReducing={pendingAction === 'reduce-seats'}
            error={actionFailure('reduce-seats')}
            onReduceSeats={handleReduceSeats}
            onAddSeatDialog={() => setIsAddSeatDialogOpen(true)}
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
            <p className='text-muted-foreground text-xs'>{copy('usageNoteBody')}</p>
          </div>
        )}

        {/* Member Invitation Card */}
        {adminOrOwner && (
          <MemberInvitationCard
            inviteEmail={inviteEmail}
            setInviteEmail={setInviteEmail}
            isInviting={inviteMutation.isPending}
            actionsDisabled={isPending || seatCountsUnavailable}
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
            invitedWorkspaceCount={invitedWorkspaceCount}
            canInviteMembers={canInviteMembers}
            inviteUnavailableMessage={inviteUnavailableMessage}
            availableSeats={organizationSeats?.availableSeats ?? 0}
          />
        )}
      </div>

      {/* Team Information Section - pinned to bottom of modal */}
      <div className='mt-6 flex-shrink-0 border-t pt-6'>
        <div className='space-y-3 text-xs'>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{copy('teamId')}</span>
            <span className='font-mono'>{displayOrganization.id}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{copy('created')}</span>
            <span>{new Date(displayOrganization.createdAt).toLocaleDateString(locale)}</span>
          </div>
          <div className='flex justify-between'>
            <span className='text-muted-foreground'>{copy('yourRole')}</span>
            <span className='font-medium'>
              {roles(userRole === 'owner' || userRole === 'admin' ? userRole : 'member')}
            </span>
          </div>
        </div>
      </div>

      <RemoveMemberDialog
        open={removeMemberDialog.open}
        memberName={removeMemberDialog.memberName}
        isSelfRemoval={removeMemberDialog.isSelfRemoval}
        isPending={pendingAction === 'remove' || removeMemberMutation.isPending}
        error={actionFailure('remove')}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setRemoveMemberDialog((prev) => (prev.open ? { ...prev, open: false } : prev))
          }
        }}
        onConfirmRemove={confirmRemoveMember}
        onCancel={() =>
          setRemoveMemberDialog({
            open: false,
            memberId: '',
            memberName: '',
            isSelfRemoval: false,
          })
        }
      />

      {isOrganizationOwner && isAdjustableSeatTier && !seatCountsUnavailable && (
        <TeamSeats
          open={isAddSeatDialogOpen}
          onOpenChange={setIsAddSeatDialogOpen}
          title={copy('addSeats.title')}
          description={
            seatPrice
              ? copy('addSeats.description', {
                  price: formatUsd(locale, seatPrice.amountUsd),
                  interval: seatPrice.interval,
                })
              : copy('addSeats.quoteUnavailable')
          }
          pricePerSeat={seatPrice?.amountUsd ?? null}
          billingInterval={seatPrice?.interval ?? null}
          minimumSeats={Math.max(seatCount, usedSeats)}
          maximumSeats={seatMaximum}
          currentSeats={totalSeats}
          initialSeats={totalSeats + 1}
          isLoading={
            pendingAction === 'update-seats' ||
            (isAddSeatDialogOpen && updateSeatsMutation.isPending)
          }
          error={actionFailure('update-seats')}
          onConfirm={confirmAddSeats}
          confirmButtonText={copy('addSeats.confirm')}
        />
      )}
    </div>
  )
}
