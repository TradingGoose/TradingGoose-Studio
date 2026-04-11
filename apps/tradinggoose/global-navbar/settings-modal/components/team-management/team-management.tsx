import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSlug, getUsedSeats, getUserRole, isAdminOrOwner } from '@/lib/organization'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import {
  useAssignWorkspaceToOrganization,
  useAvailableOrganizationBillingWorkspaces,
  useCancelInvitation,
  useCreateOrganization,
  useInviteMember,
  useOrganization,
  useOrganizationBilling,
  useOrganizationBillingWorkspaces,
  useOrganizations,
  useReleaseWorkspaceFromOrganization,
  useRemoveMember,
  useUpdateSeats,
} from '@/hooks/queries/organization'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'
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

type TeamBillingTier = {
  id?: string | null
  displayName: string
  ownerType: 'user' | 'organization'
  seatMode: 'fixed' | 'adjustable'
  monthlyPriceUsd: number | null
  seatCount: number | null
  seatMaximum: number | null
  canEditUsageLimit: boolean
  canConfigureSso: boolean
}

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
  tier: TeamBillingTier | null
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
    error: organizationBillingError,
  } = useOrganizationBilling(activeOrgId || '')
  const { data: publicBillingCatalog } = usePublicBillingCatalog()

  const inviteMutation = useInviteMember()
  const removeMemberMutation = useRemoveMember()
  const updateSeatsMutation = useUpdateSeats()
  const createOrgMutation = useCreateOrganization()
  const assignWorkspaceToOrganizationMutation = useAssignWorkspaceToOrganization()
  const cancelInvitationMutation = useCancelInvitation()
  const releaseWorkspaceFromOrganizationMutation = useReleaseWorkspaceFromOrganization()
  const {
    data: adminWorkspaces = [],
    isLoading: isLoadingWorkspaces,
    refetch: refetchAdminWorkspaces,
  } = useAdminWorkspaces(session?.user?.id)
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
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false)
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean
    memberId: string
    memberName: string
    shouldReduceSeats: boolean
    isSelfRemoval?: boolean
  }>({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [isAddSeatDialogOpen, setIsAddSeatDialogOpen] = useState(false)
  const [newSeatCount, setNewSeatCount] = useState(1)
  const [isUpdatingSeats, setIsUpdatingSeats] = useState(false)

  const personalBillingPayload = (userSubscriptionData as any)?.data ?? userSubscriptionData
  const organizationSubscriptionData: TeamSubscriptionData | null = organizationBillingData
    ? {
        id: organizationBillingData.organizationId,
        billingEnabled: organizationBillingData.billingEnabled,
        isPaid: (organizationBillingData.subscriptionTier.monthlyPriceUsd ?? 0) > 0,
        status: organizationBillingData.subscriptionStatus,
        seats: organizationBillingData.totalSeats,
        referenceId: organizationBillingData.organizationId,
        metadata: null,
        stripeSubscriptionId: null,
        periodEnd: organizationBillingData.billingPeriodEnd
          ? new Date(organizationBillingData.billingPeriodEnd)
          : undefined,
        cancelAtPeriodEnd: false,
        tier: {
          id: organizationBillingData.subscriptionTier.id,
          displayName: organizationBillingData.subscriptionTier.displayName,
          ownerType: organizationBillingData.subscriptionTier.ownerType,
          seatMode:
            organizationBillingData.subscriptionTier.seatMode === 'adjustable'
              ? 'adjustable'
              : 'fixed',
          monthlyPriceUsd: organizationBillingData.subscriptionTier.monthlyPriceUsd,
          seatCount: organizationBillingData.subscriptionTier.seatCount,
          seatMaximum: organizationBillingData.subscriptionTier.seatMaximum,
          canEditUsageLimit: organizationBillingData.subscriptionTier.canEditUsageLimit,
          canConfigureSso: organizationBillingData.subscriptionTier.canConfigureSso,
        },
        usage: {
          current: organizationBillingData.totalCurrentUsage,
          limit: organizationBillingData.totalUsageLimit,
          percentUsed:
            organizationBillingData.totalUsageLimit > 0
              ? (organizationBillingData.totalCurrentUsage /
                  organizationBillingData.totalUsageLimit) *
                100
              : 0,
          isWarning:
            organizationBillingData.totalUsageLimit > 0 &&
            (organizationBillingData.totalCurrentUsage / organizationBillingData.totalUsageLimit) *
              100 >=
              organizationBillingData.warningThresholdPercent,
          isExceeded:
            organizationBillingData.totalUsageLimit > 0 &&
            organizationBillingData.totalCurrentUsage >= organizationBillingData.totalUsageLimit,
          billingPeriodStart: organizationBillingData.billingPeriodStart
            ? new Date(organizationBillingData.billingPeriodStart)
            : null,
          billingPeriodEnd: organizationBillingData.billingPeriodEnd
            ? new Date(organizationBillingData.billingPeriodEnd)
            : null,
          lastPeriodCost: organizationBillingData.lastPeriodCost ?? 0,
          lastPeriodCopilotCost: organizationBillingData.lastPeriodCopilotCost ?? 0,
          copilotCost: organizationBillingData.currentPeriodCopilotCost ?? 0,
        },
        billingBlocked: organizationBillingData.billingBlocked,
      }
    : null
  const billingPayload = displayOrganization ? organizationSubscriptionData : personalBillingPayload
  const subscriptionData = billingPayload as TeamSubscriptionData | null
  const currentTier = subscriptionData?.tier ?? null
  const personalTier = (personalBillingPayload as TeamSubscriptionData | null)?.tier ?? null
  const hasOrganizationWorkspaceAccess = displayOrganization
    ? currentTier?.ownerType === 'organization'
    : personalTier?.ownerType === 'organization'
  const isLoadingSubscription = displayOrganization
    ? isLoadingOrganizationBilling
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

  const usedSeats = getUsedSeats(displayOrganization)

  useEffect(() => {
    if (hasOrganizationWorkspaceAccess && session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [hasOrganizationWorkspaceAccess, session?.user?.name, orgName])

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

    try {
      await createOrgMutation.mutateAsync({
        name: orgName.trim(),
        slug: orgSlug.trim(),
      })

      setCreateOrgDialogOpen(false)
      setOrgName('')
      setOrgSlug('')
    } catch (error) {
      logger.error('Failed to create organization', error)
    }
  }, [session?.user?.id, orgName, orgSlug, createOrgMutation])

  const handleInviteMember = useCallback(async () => {
    if (!session?.user || !activeOrgId || !inviteEmail.trim()) return

    try {
      const workspaceInvitations =
        selectedWorkspaces.length > 0
          ? selectedWorkspaces.map((w) => ({
              id: w.workspaceId,
              name: adminWorkspaces.find((uw) => uw.id === w.workspaceId)?.name || '',
            }))
          : undefined

      await inviteMutation.mutateAsync({
        email: inviteEmail.trim(),
        orgId: activeOrgId,
        workspaceInvitations,
      })

      setInviteSuccess(true)
      setTimeout(() => setInviteSuccess(false), 3000)

      setInviteEmail('')
      setSelectedWorkspaces([])
      setShowWorkspaceInvite(false)
    } catch (error) {
      logger.error('Failed to invite member', error)
    }
  }, [
    session?.user?.id,
    activeOrgId,
    inviteEmail,
    selectedWorkspaces,
    adminWorkspaces,
    subscriptionData,
    inviteMutation,
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

      try {
        await removeMemberMutation.mutateAsync({
          memberId,
          orgId: activeOrgId,
          shouldReduceSeats,
        })
        setRemoveMemberDialog({
          open: false,
          memberId: '',
          memberName: '',
          shouldReduceSeats: false,
        })
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [removeMemberDialog.memberId, session?.user?.id, activeOrgId, removeMemberMutation]
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

    try {
      await updateSeatsMutation.mutateAsync({
        orgId: activeOrgId,
        seats: currentSeats - 1,
      })
    } catch (error) {
      logger.error('Failed to reduce seats', error)
    }
  }, [session?.user?.id, activeOrgId, subscriptionData, usedSeats.used, updateSeatsMutation])

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
      setIsUpdatingSeats(true)

      try {
        await updateSeatsMutation.mutateAsync({
          orgId: activeOrgId,
          seats: seatsToUse,
        })
        setIsAddSeatDialogOpen(false)
      } catch (error) {
        logger.error('Failed to add seats', error)
      } finally {
        setIsUpdatingSeats(false)
      }
    },
    [subscriptionData, activeOrgId, newSeatCount, updateSeatsMutation]
  )

  const handleAssignWorkspaceBilling = useCallback(
    async (workspaceId: string) => {
      if (!activeOrgId) {
        return
      }

      try {
        await assignWorkspaceToOrganizationMutation.mutateAsync({
          organizationId: activeOrgId,
          workspaceId,
        })
      } catch (error) {
        logger.error('Failed to assign workspace to organization billing', {
          error,
          organizationId: activeOrgId,
          workspaceId,
        })
      }
    },
    [activeOrgId, assignWorkspaceToOrganizationMutation]
  )

  const handleReleaseWorkspaceBilling = useCallback(
    async (workspaceId: string) => {
      if (!activeOrgId) {
        return
      }

      try {
        await releaseWorkspaceFromOrganizationMutation.mutateAsync({
          organizationId: activeOrgId,
          workspaceId,
        })
      } catch (error) {
        logger.error('Failed to release workspace from organization billing', {
          error,
          organizationId: activeOrgId,
          workspaceId,
        })
      }
    },
    [activeOrgId, releaseWorkspaceFromOrganizationMutation]
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
  const errorMessage = queryError instanceof Error ? queryError.message : null
  const workspaceBillingError =
    (assignWorkspaceToOrganizationMutation.error instanceof Error
      ? assignWorkspaceToOrganizationMutation.error.message
      : null) ||
    (releaseWorkspaceFromOrganizationMutation.error instanceof Error
      ? releaseWorkspaceFromOrganizationMutation.error.message
      : null)

  if (isLoading && !displayOrganization && !hasOrganizationWorkspaceAccess) {
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
        hasOrganizationWorkspaceAccess={Boolean(hasOrganizationWorkspaceAccess)}
        orgName={orgName}
        setOrgName={setOrgName}
        orgSlug={orgSlug}
        setOrgSlug={setOrgSlug}
        onOrgNameChange={handleOrgNameChange}
        onCreateOrganization={handleCreateOrganization}
        isCreatingOrg={createOrgMutation.isPending}
        error={errorMessage}
        createOrgDialogOpen={createOrgDialogOpen}
        setCreateOrgDialogOpen={setCreateOrgDialogOpen}
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

        <WorkspaceBilling
          billedWorkspaces={organizationBillingWorkspaces}
          availableWorkspaces={availableOrganizationBillingWorkspaces}
          canManage={adminOrOwner}
          hasOrganizationBilling={Boolean(currentTier?.ownerType === 'organization')}
          isLoading={
            isLoadingOrganizationBillingWorkspaces ||
            isLoadingAvailableOrganizationBillingWorkspaces
          }
          isAssigning={assignWorkspaceToOrganizationMutation.isPending}
          isReleasing={releaseWorkspaceFromOrganizationMutation.isPending}
          error={workspaceBillingError}
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
          onRemoveMember={handleRemoveMember}
          onCancelInvitation={async (invitationId: string) => {
            if (!displayOrganization?.id) return
            await cancelInvitationMutation.mutateAsync({
              invitationId,
              orgId: displayOrganization.id,
            })
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
            seatLimited={Boolean(currentTier?.ownerType === 'organization')}
            availableSeats={Math.max(0, (subscriptionData?.seats || 0) - usedSeats.used)}
            maxSeats={subscriptionData?.seats || 0}
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
        isLoading={isUpdatingSeats || updateSeatsMutation.isPending}
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
