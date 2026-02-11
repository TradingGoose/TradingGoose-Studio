import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { DEFAULT_TEAM_TIER_COST_LIMIT } from '@/lib/billing/constants'
import { checkEnterprisePlan } from '@/lib/billing/subscriptions/utils'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { generateSlug, getUsedSeats, getUserRole, isAdminOrOwner } from '@/lib/organization'
import {
  MemberInvitationCard,
  NoOrganizationView,
  RemoveMemberDialog,
  TeamMembers,
  TeamSeats,
  TeamSeatsOverview,
  TeamUsage,
} from './components'
import {
  useCancelInvitation,
  useCreateOrganization,
  useInviteMember,
  useOrganization,
  useOrganizationSubscription,
  useOrganizations,
  useRemoveMember,
  useUpdateSeats,
} from '@/hooks/queries/organization'
import { useAdminWorkspaces } from '@/hooks/queries/workspace'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('TeamManagement')

export function TeamManagement() {
  const { data: session } = useSession()

  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const billingData = organizationsData?.billingData?.data
  const hasTeamPlan = billingData?.isTeam ?? false
  const hasEnterprisePlan = billingData?.isEnterprise ?? false

  const {
    data: organization,
    isLoading,
    error: orgError,
  } = useOrganization(activeOrganization?.id || '')

  const {
    data: subscriptionData,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useOrganizationSubscription(activeOrganization?.id || '')

  const { data: userSubscriptionData } = useSubscriptionData()

  const inviteMutation = useInviteMember()
  const removeMemberMutation = useRemoveMember()
  const updateSeatsMutation = useUpdateSeats()
  const createOrgMutation = useCreateOrganization()
  const cancelInvitationMutation = useCancelInvitation()
  const {
    data: adminWorkspaces = [],
    isLoading: isLoadingWorkspaces,
    refetch: refetchAdminWorkspaces,
  } = useAdminWorkspaces(session?.user?.id)

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

  const displayOrganization = organization || activeOrganization || null
  const activeOrgId = displayOrganization?.id

  const userRole = getUserRole(displayOrganization, session?.user?.email)
  const adminOrOwner = isAdminOrOwner(displayOrganization, session?.user?.email)
  const usedSeats = getUsedSeats(displayOrganization)

  useEffect(() => {
    if ((hasTeamPlan || hasEnterprisePlan) && session?.user?.name && !orgName) {
      const defaultName = `${session.user.name}'s Team`
      setOrgName(defaultName)
      setOrgSlug(generateSlug(defaultName))
    }
  }, [hasTeamPlan, hasEnterprisePlan, session?.user?.name, orgName])

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
        setRemoveMemberDialog({ open: false, memberId: '', memberName: '', shouldReduceSeats: false })
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [removeMemberDialog.memberId, session?.user?.id, activeOrgId, removeMemberMutation]
  )

  const handleReduceSeats = useCallback(async () => {
    if (!session?.user || !activeOrgId || !subscriptionData) return
    if (checkEnterprisePlan(subscriptionData)) return

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
    if (subscriptionData) {
      setNewSeatCount((subscriptionData.seats || 1) + 1)
      setIsAddSeatDialogOpen(true)
    }
  }, [subscriptionData?.seats])

  const confirmAddSeats = useCallback(
    async (selectedSeats?: number) => {
      if (!subscriptionData || !activeOrgId) return

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

  const confirmTeamUpgrade = useCallback(
    async (seats: number) => {
      if (!session?.user || !activeOrgId) return
      logger.info('Team upgrade requested', { seats, organizationId: activeOrgId })
      alert(`Team upgrade to ${seats} seats - integration needed`)
    },
    [session?.user?.id, activeOrgId]
  )

  const queryError = orgError || subscriptionError
  const errorMessage = queryError instanceof Error ? queryError.message : null

  if (isLoading && !displayOrganization && !(hasTeamPlan || hasEnterprisePlan)) {
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
        hasTeamPlan={hasTeamPlan}
        hasEnterprisePlan={hasEnterprisePlan}
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

        {/* Team Billing Information (only show for Team Plan, not Enterprise) */}
        {hasTeamPlan && !hasEnterprisePlan && (
          <div className='rounded-sm border bg-blue-50/50 p-4 shadow-xs dark:bg-blue-950/20'>
            <div className='space-y-3'>
              <h4 className='font-medium text-sm'>How Team Billing Works</h4>
              <ul className='ml-4 list-disc space-y-2 text-muted-foreground text-xs'>
                <li>
                  Your team is billed a minimum of $
                  {(subscriptionData?.seats || 0) *
                    (env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT)}
                  /month for {subscriptionData?.seats || 0} licensed seats
                </li>
                <li>All team member usage is pooled together from a shared limit</li>
                <li>
                  When pooled usage exceeds the limit, all members are blocked from using the
                  service
                </li>
                <li>You can increase the usage limit to allow for higher usage</li>
                <li>
                  Any usage beyond the minimum seat cost is billed as overage at the end of the
                  billing period
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Team Seats Overview */}
        {adminOrOwner && (
          <TeamSeatsOverview
            subscriptionData={
              subscriptionData ||
              ((userSubscriptionData as any)?.data ?? userSubscriptionData) ||
              null
            }
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
        onConfirmRemove={confirmRemoveMember}
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
        open={isAddSeatDialogOpen}
        onOpenChange={setIsAddSeatDialogOpen}
        title='Add Team Seats'
        description={`Each seat costs $${env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT}/month and provides $${env.TEAM_TIER_COST_LIMIT ?? DEFAULT_TEAM_TIER_COST_LIMIT} in monthly inference credits. Adjust the number of licensed seats for your team.`}
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
