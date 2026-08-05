'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Input, Skeleton, Switch } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/auth-client'
import { openBillingPortal as openBillingPortalSession } from '@/lib/billing/billing-portal'
import { formatBillingPriceLabel, formatBillingPricePeriod } from '@/lib/billing/public-catalog'
import {
  composeSubscriptionTierDisplays,
  type SubscriptionTierDisplay,
} from '@/lib/billing/subscription-tier-display'
import { canEditUsageLimit } from '@/lib/billing/subscriptions/utils'
import { getUserRole } from '@/lib/organization'
import { getBillingStatus, getSubscriptionStatus, getUsage } from '@/lib/subscription/helpers'
import type { BillingUpgradeTarget } from '@/lib/subscription/upgrade'
import { useSubscriptionUpgrade } from '@/lib/subscription/upgrade'
import { cn } from '@/lib/utils'
import {
  type GeneralSettings,
  generalSettingsKeys,
  patchBillingUsageNotifications,
} from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { usePrivateTierAccess } from '@/hooks/queries/private-tier-access'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { useGeneralStore } from '@/stores/settings/general/store'
import { UsageHeader } from '../shared/usage-header'
import { PlanCard, UsageLimit, type UsageLimitRef, WorkspaceBillingOwnerEditor } from './components'
import {
  getPersonalPaygUiState,
  type PaygActivationErrorPayload,
  shouldOpenBillingPortalForPaygActivationError,
} from './payg-ui'
import { toPlanFeatures } from './plan-configs'
import { getSubscriptionSurfaceState } from './subscription-permissions'

const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000,
} as const

const safeNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

function BillingUsageNotificationsToggle({ userId }: { userId: string | null }) {
  const copy = useTranslations('workspace.settingsModal.subscription')
  const queryClient = useQueryClient()
  const titleId = useId()
  const descriptionId = useId()
  const feedbackId = useId()
  const writeLockRef = useRef(false)
  const enabled = useGeneralStore((state) => state.isBillingUsageNotificationsEnabled)
  const settingsKey = generalSettingsKeys.settings(userId)
  const mutation = useMutation<void, Error, boolean, { previousEnabled: boolean }>({
    mutationFn: patchBillingUsageNotifications,
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey: settingsKey })
      const previousEnabled = useGeneralStore.getState().isBillingUsageNotificationsEnabled
      useGeneralStore.setState({ isBillingUsageNotificationsEnabled: value })
      queryClient.setQueryData<GeneralSettings>(settingsKey, (settings) =>
        settings ? { ...settings, billingUsageNotificationsEnabled: value } : settings
      )
      return { previousEnabled }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
    onError: (_error, _value, context) => {
      if (!context) return
      useGeneralStore.setState({
        isBillingUsageNotificationsEnabled: context.previousEnabled,
      })
      queryClient.setQueryData<GeneralSettings>(settingsKey, (settings) =>
        settings
          ? { ...settings, billingUsageNotificationsEnabled: context.previousEnabled }
          : settings
      )
    },
    onSettled: () => {
      writeLockRef.current = false
    },
  })
  const handleCheckedChange = (value: boolean) => {
    if (!userId || writeLockRef.current || value === enabled) return
    writeLockRef.current = true
    mutation.reset()
    mutation.mutate(value)
  }
  const feedback = mutation.isPending
    ? copy('notifications.pending')
    : mutation.isError
      ? copy('notifications.error')
      : null

  return (
    <div className='mt-4 flex items-start justify-between gap-4'>
      <div className='flex flex-col'>
        <span id={titleId} className='font-medium text-sm'>
          {copy('titles.usageNotifications')}
        </span>
        <span id={descriptionId} className='text-muted-foreground text-xs'>
          {copy('descriptions.usageNotifications')}
        </span>
        {feedback && (
          <span
            id={feedbackId}
            role={mutation.isError ? 'alert' : 'status'}
            aria-atomic='true'
            className={
              mutation.isError ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'
            }
          >
            {feedback}
          </span>
        )}
      </div>
      <Switch
        checked={enabled}
        disabled={!userId || mutation.isPending}
        aria-busy={mutation.isPending || undefined}
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${feedback ? ` ${feedbackId}` : ''}`}
        onCheckedChange={handleCheckedChange}
      />
    </div>
  )
}

interface SubscriptionProps {
  onOpenChange: (open: boolean) => void
}

function SubscriptionSkeleton() {
  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        <div className='mb-2'>
          <div className='rounded-md border bg-background p-3 shadow-xs'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-5 w-16' />
                  <Skeleton className='h-[1.125rem] w-14 rounded-sm' />
                </div>
                <div className='flex items-center gap-1 text-xs tabular-nums'>
                  <Skeleton className='h-4 w-8' />
                  <span className='text-muted-foreground'>/</span>
                  <Skeleton className='h-4 w-8' />
                </div>
              </div>
              <Skeleton className='h-2 w-full rounded' />
            </div>
          </div>
        </div>

        <div className='flex flex-col gap-2'>
          <div className='grid grid-cols-2 gap-2'>
            <div className='flex flex-col rounded-sm border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-8' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className='flex items-start gap-2'>
                    <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                    <Skeleton className='h-3 w-20' />
                  </div>
                ))}
              </div>
              <Skeleton className='h-9 w-full rounded-sm' />
            </div>

            <div className='flex flex-col rounded-sm border p-4'>
              <div className='mb-4'>
                <Skeleton className='mb-2 h-5 w-10' />
                <div className='flex items-baseline'>
                  <Skeleton className='h-6 w-10' />
                  <Skeleton className='ml-1 h-3 w-12' />
                </div>
              </div>
              <div className='mb-4 flex-1 space-y-2'>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className='flex items-start gap-2'>
                    <Skeleton className='mt-0.5 h-3 w-3 rounded' />
                    <Skeleton className='h-3 w-24' />
                  </div>
                ))}
              </div>
              <Skeleton className='h-9 w-full rounded-sm' />
            </div>
          </div>

          <div className='flex items-center justify-between rounded-sm border p-4'>
            <div>
              <Skeleton className='mb-2 h-5 w-20' />
              <Skeleton className='mb-3 h-3 w-64' />
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-16' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
                <div className='h-4 w-px bg-border' />
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-3 w-3 rounded' />
                  <Skeleton className='h-3 w-20' />
                </div>
              </div>
            </div>
            <Skeleton className='h-9 w-16 rounded-sm' />
          </div>
        </div>
      </div>
    </div>
  )
}

function toUpgradeTarget(tier: SubscriptionTierDisplay): BillingUpgradeTarget {
  return {
    billingTierId: tier.id,
    displayName: tier.displayName,
    ownerType: tier.ownerType,
    usageScope: tier.usageScope,
    seatMode: tier.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
    seatCount: tier.seatCount,
  }
}

function openContactUrl(url: string | null) {
  if (!url) {
    return
  }

  window.open(url, '_blank')
}

export function Subscription({ onOpenChange }: SubscriptionProps) {
  const t = useTranslations('workspace.settingsModal.subscription')
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    refetch: refetchSubscription,
  } = useSubscriptionData()
  const {
    data: usageLimitResponse,
    isLoading: isUsageLimitLoading,
    refetch: refetchUsageLimit,
  } = useUsageLimitData()
  const { data: organizationsData } = useOrganizations()
  const { data: publicBillingCatalog, isLoading: isCatalogLoading } = usePublicBillingCatalog()
  const {
    data: privateTierAccess,
    isLoading: isPrivateTierAccessLoading,
    validateAccessCode: validatePrivateTierCode,
  } = usePrivateTierAccess({ enabled: Boolean(session?.user?.id) })

  const activeOrganization = organizationsData?.activeOrganization
  const activeOrgId = activeOrganization?.id
  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    activeOrgId || ''
  )

  const [upgradeError, setUpgradeError] = useState<string | null>(null)
  const [accessCode, setAccessCode] = useState('')
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null)
  const [accessCodeMessage, setAccessCodeMessage] = useState<string | null>(null)
  const [isPrimaryActionPending, setIsPrimaryActionPending] = useState(false)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const organizationBillingPayload =
    (organizationBillingData as any)?.data ?? organizationBillingData
  const subscription = getSubscriptionStatus(billingPayload)
  const usage = getUsage(billingPayload)
  const billingStatus = getBillingStatus(billingPayload)

  const defaultMinimumLimit = safeNumber(subscription.tier.monthlyPriceUsd)
  const usageLimitPayload = (usageLimitResponse as any)?.data ?? usageLimitResponse
  const usageLimitInfo = {
    currentLimit: usageLimitPayload?.currentLimit ?? usage.limit,
    minimumLimit: usageLimitPayload?.minimumLimit ?? defaultMinimumLimit,
  }

  useEffect(() => {
    if (upgradeError) {
      const timer = setTimeout(() => {
        setUpgradeError(null)
      }, CONSTANTS.UPGRADE_ERROR_TIMEOUT)
      return () => clearTimeout(timer)
    }
  }, [upgradeError])

  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)

  const subscriptionTiers = composeSubscriptionTierDisplays({
    publicTiers: publicBillingCatalog?.publicTiers ?? [],
    privateTiers: privateTierAccess?.privateTiers ?? [],
    currentTier: subscription.tier,
  })
  const enterpriseContactCard = privateTierAccess?.enterpriseContactCard ?? null
  const surfaceState = getSubscriptionSurfaceState({
    subscription: {
      isFree: subscription.isFree,
      isPaid: subscription.isPaid,
      tier: subscription.tier,
    },
    userRole: {
      isTeamAdmin,
    },
    subscriptionTiers,
    enterpriseContactCard,
  })

  const isOrganizationPlan = surfaceState.isOrganizationPlan
  const aggregatedCurrentUsage = safeNumber(
    isOrganizationPlan
      ? (organizationBillingPayload?.totalCurrentUsage ?? usage.current)
      : usage.current
  )
  const aggregatedUsageLimit = safeNumber(
    isOrganizationPlan
      ? (organizationBillingPayload?.totalUsageLimit ??
          organizationBillingPayload?.minimumUsageLimit ??
          usage.limit)
      : usage.limit
  )
  const percentUsedRaw = isOrganizationPlan
    ? (() => {
        const totalLimit = organizationBillingPayload?.totalUsageLimit
        if (totalLimit && totalLimit > 0) {
          return ((organizationBillingPayload?.totalCurrentUsage ?? 0) / totalLimit) * 100
        }
        return usage.percentUsed
      })()
    : usage.percentUsed
  const percentUsedClamped = Math.max(0, Math.min(Math.round(percentUsedRaw ?? 0), 100))
  const organizationWarningThresholdPercent =
    typeof organizationBillingPayload?.warningThresholdPercent === 'number'
      ? organizationBillingPayload.warningThresholdPercent
      : 100
  const hasPaymentMethodOnFile = Boolean(billingPayload?.hasPaymentMethodOnFile)
  const hasStripeSubscription = Boolean(billingPayload?.stripeSubscriptionId)
  const canEditPersonalUsageLimit = canEditUsageLimit(billingPayload)
  const personalPaygUiState = getPersonalPaygUiState({
    billingBlocked: Boolean(billingPayload?.billingBlocked),
    hasPaymentMethodOnFile,
    hasStripeSubscription,
    hasStripeMonthlyPriceId: Boolean(subscription.tier.hasStripeMonthlyPriceId),
    subscriptionStatus: billingPayload?.status ?? null,
    canEditUsageLimit: canEditPersonalUsageLimit,
    tierCanEditUsageLimit: surfaceState.canEditUsageLimit,
  })
  const normalizedBillingStatus = billingPayload?.billingBlocked
    ? 'blocked'
    : isOrganizationPlan
      ? percentUsedClamped >= 100
        ? 'exceeded'
        : percentUsedRaw >= organizationWarningThresholdPercent
          ? 'warning'
          : 'ok'
      : billingStatus === 'unknown'
        ? 'ok'
        : (billingStatus as 'ok' | 'warning' | 'exceeded' | 'blocked')

  const showBadge = isOrganizationPlan
    ? surfaceState.canEditUsageLimit && !surfaceState.showTeamMemberView
    : personalPaygUiState.showBadge
  const showPersonalUsageLimitControl =
    !isOrganizationPlan &&
    personalPaygUiState.showUsageLimitControl &&
    (surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView)
  const showUsageLimitControl = isOrganizationPlan
    ? surfaceState.canEditUsageLimit || surfaceState.showTeamMemberView
    : showPersonalUsageLimitControl
  const showPersonalSubscriptionManagement = !isOrganizationPlan && hasStripeSubscription
  const showManageSubscriptionRow =
    (subscription.isPaid || showPersonalSubscriptionManagement) &&
    !surfaceState.isCustomOrganizationPlan &&
    !surfaceState.showTeamMemberView
  const badgeText =
    !isOrganizationPlan && personalPaygUiState.showBadge
      ? personalPaygUiState.badgeText
      : subscription.isFree
        ? t('titles.upgrade')
        : t('titles.increaseLimit')
  const hasVisiblePlanCards =
    surfaceState.visiblePlanTiers.length > 0 || surfaceState.showEnterprisePlaceholder
  const enterpriseContactUrl = surfaceState.enterprisePlaceholder?.contactUrl ?? null

  const validateAccessCode = async () => {
    const code = accessCode.trim()
    if (!code) {
      setAccessCodeError(t('privateAccess.required'))
      return
    }
    setAccessCodeError(null)
    setAccessCodeMessage(null)
    try {
      await validatePrivateTierCode.mutateAsync(code)
      setAccessCode('')
      setAccessCodeMessage(t('privateAccess.success'))
    } catch {
      setAccessCodeError(t('privateAccess.invalid'))
    }
  }

  const handleUpgradeWithErrorHandling = useCallback(
    async (targetTier: BillingUpgradeTarget) => {
      try {
        await handleUpgrade(targetTier, {
          ...(targetTier.ownerType === 'organization' && activeOrgId
            ? { organizationId: activeOrgId }
            : {}),
        })
      } catch (error) {
        setUpgradeError(targetTier.billingTierId)
        alert(error instanceof Error ? error.message : t('errors.unknown'))
      }
    },
    [activeOrgId, handleUpgrade]
  )

  const openBillingPortal = useCallback(
    async (context: 'user' | 'organization') => {
      if (context === 'organization' && !activeOrgId) {
        alert(t('errors.selectOrganization'))
        return
      }

      await openBillingPortalSession({
        context,
        organizationId: context === 'organization' ? activeOrgId : undefined,
      })
    },
    [activeOrgId]
  )

  const activatePayg = useCallback(async () => {
    setIsPrimaryActionPending(true)

    try {
      const response = await fetch('/api/billing/payg/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = (await response.json().catch(() => ({}))) as PaygActivationErrorPayload

      if (!response.ok) {
        if (shouldOpenBillingPortalForPaygActivationError(response.status, result)) {
          await openBillingPortal('user')
          return
        }

        throw new Error(result?.error || t('errors.activatePayg'))
      }

      await Promise.all([refetchSubscription(), refetchUsageLimit()])
    } finally {
      setIsPrimaryActionPending(false)
    }
  }, [openBillingPortal, refetchSubscription, refetchUsageLimit, t])

  const handleBadgeClick = () => {
    if (isPrimaryActionPending) {
      return
    }

    if (!isOrganizationPlan && personalPaygUiState.showBadge) {
      switch (personalPaygUiState.primaryAction) {
        case 'resolve_payment':
        case 'add_payment_method':
        case 'manage_billing':
          void openBillingPortal('user').catch((error) => {
            alert(error instanceof Error ? error.message : t('errors.openBillingPortal'))
          })
          return
        case 'activate_payg':
          void activatePayg().catch((error) => {
            alert(error instanceof Error ? error.message : t('errors.activatePayg'))
          })
          return
        case 'increase_limit':
          if (usageLimitRef.current) {
            usageLimitRef.current.startEdit()
          }
          return
      }
    }

    if (subscription.isFree) {
      const defaultUpgradeTier = surfaceState.visiblePlanTiers.find(
        (tier) => tier.id !== surfaceState.currentTier?.id
      )
      if (defaultUpgradeTier) {
        void handleUpgradeWithErrorHandling(toUpgradeTarget(defaultUpgradeTier))
      }
      return
    }

    if (surfaceState.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }

  const isLoading =
    isSubscriptionLoading ||
    isUsageLimitLoading ||
    isOrgBillingLoading ||
    isCatalogLoading ||
    isPrivateTierAccessLoading

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  if (isSubscriptionError) {
    onOpenChange(false)
    return null
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-2'>
        <div className='mb-2'>
          <UsageHeader
            title={subscription.tier.displayName}
            gradientTitle={!subscription.isFree}
            showBadge={showBadge}
            badgeText={badgeText}
            onBadgeClick={handleBadgeClick}
            seatsText={
              surfaceState.canManageOrganizationPlan || surfaceState.isCustomOrganizationPlan
                ? t('seatsText', {
                    count: organizationBillingPayload?.totalSeats || subscription.seats || 1,
                  })
                : undefined
            }
            current={aggregatedCurrentUsage}
            limit={
              isOrganizationPlan
                ? aggregatedUsageLimit
                : showUsageLimitControl
                  ? safeNumber(usage.current)
                  : safeNumber(usage.limit)
            }
            isBlocked={Boolean(billingPayload?.billingBlocked)}
            status={normalizedBillingStatus}
            percentUsed={percentUsedClamped}
            onResolvePayment={async () => {
              try {
                await openBillingPortal(isOrganizationPlan ? 'organization' : 'user')
              } catch (error) {
                alert(error instanceof Error ? error.message : t('errors.openBillingPortal'))
              }
            }}
            rightContent={
              showUsageLimitControl ? (
                <UsageLimit
                  ref={usageLimitRef}
                  currentLimit={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? aggregatedUsageLimit
                      : usageLimitInfo.currentLimit
                  }
                  currentUsage={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? aggregatedCurrentUsage
                      : safeNumber(usage.current)
                  }
                  canEdit={surfaceState.canEditUsageLimit}
                  minimumLimit={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin
                      ? safeNumber(
                          organizationBillingPayload?.minimumUsageLimit ??
                            usageLimitInfo.minimumLimit
                        )
                      : usageLimitInfo.minimumLimit
                  }
                  context={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin ? 'organization' : 'user'
                  }
                  organizationId={
                    surfaceState.isAdjustableSeatPlan && isTeamAdmin ? activeOrgId : undefined
                  }
                />
              ) : undefined
            }
            progressValue={percentUsedClamped}
          />
        </div>

        {surfaceState.showTeamMemberView && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>{t('descriptions.teamMemberView')}</p>
          </div>
        )}

        {session?.user?.id ? (
          <div className='flex flex-col gap-2 rounded-sm border p-3'>
            <div className='flex gap-2'>
              <Input
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder={t('privateAccess.placeholder')}
                aria-label={t('privateAccess.label')}
              />
              <Button
                type='button'
                variant='outline'
                disabled={validatePrivateTierCode.isPending || !accessCode.trim()}
                onClick={() => void validateAccessCode()}
              >
                {t('privateAccess.validate')}
              </Button>
            </div>
            {accessCodeError ? <p className='text-destructive text-xs'>{accessCodeError}</p> : null}
            {accessCodeMessage ? (
              <p className='text-muted-foreground text-xs'>{accessCodeMessage}</p>
            ) : null}
          </div>
        ) : null}

        {hasVisiblePlanCards && (
          <div className='flex flex-col gap-2'>
            {surfaceState.visiblePlanTiers.length > 0 && (
              <div
                className={cn(
                  'grid gap-2',
                  surfaceState.visiblePlanTiers.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                )}
              >
                {surfaceState.visiblePlanTiers.map((tier) => {
                  const isCurrentTier = tier.id === surfaceState.currentTier?.id
                  const isDisabled = isCurrentTier || tier.isCurrentOnly || tier.status !== 'active'

                  return (
                    <PlanCard
                      key={tier.id}
                      name={tier.displayName}
                      price={formatBillingPriceLabel(tier)}
                      priceSubtext={formatBillingPricePeriod(tier) ?? undefined}
                      features={toPlanFeatures(tier.pricingFeatures)}
                      buttonText={
                        isDisabled
                          ? t('actions.current')
                          : subscription.isFree
                            ? t('titles.upgrade')
                            : t('actions.upgradeTo', { name: tier.displayName })
                      }
                      onButtonClick={
                        isDisabled
                          ? () => {}
                          : () => handleUpgradeWithErrorHandling(toUpgradeTarget(tier))
                      }
                      buttonDisabled={isDisabled}
                      isError={!isCurrentTier && upgradeError === tier.id}
                      layout='vertical'
                    />
                  )
                })}
              </div>
            )}

            {surfaceState.showEnterprisePlaceholder && surfaceState.enterprisePlaceholder && (
              <PlanCard
                name={surfaceState.enterprisePlaceholder.displayName}
                price={t('titles.custom')}
                priceSubtext={
                  surfaceState.visiblePlanTiers.length !== 1
                    ? surfaceState.enterprisePlaceholder.description
                    : undefined
                }
                features={toPlanFeatures(surfaceState.enterprisePlaceholder.pricingFeatures)}
                buttonText={t('actions.contact')}
                onButtonClick={() => openContactUrl(enterpriseContactUrl)}
                layout={surfaceState.visiblePlanTiers.length === 1 ? 'vertical' : 'horizontal'}
              />
            )}
          </div>
        )}

        {(subscription.isPaid || showPersonalSubscriptionManagement) &&
          billingPayload?.periodEnd && (
            <div className='mt-4 flex items-center justify-between'>
              <span className='font-medium text-sm'>{t('titles.nextBillingDate')}</span>
              <span className='text-muted-foreground text-sm'>
                {new Date(billingPayload.periodEnd).toLocaleDateString()}
              </span>
            </div>
          )}

        {(subscription.isPaid || showPersonalSubscriptionManagement) && (
          <BillingUsageNotificationsToggle userId={session?.user?.id ?? null} />
        )}

        <WorkspaceBillingOwnerEditor />

        {surfaceState.isCustomOrganizationPlan && (
          <div className='text-center'>
            <p className='text-muted-foreground text-xs'>{t('descriptions.customPlan')}</p>
          </div>
        )}

        {showManageSubscriptionRow && (
          <div className='mt-2'>
            <div className='flex items-center justify-between'>
              <div>
                <span className='font-medium text-sm'>
                  {billingPayload?.cancelAtPeriodEnd ? t('titles.restore') : t('titles.manage')}
                </span>
                <p className='mt-1 text-muted-foreground text-xs'>{t('descriptions.manage')}</p>
              </div>
              <Button
                variant='outline'
                className='h-8 rounded-sm font-medium text-xs'
                onClick={() => {
                  void openBillingPortal(isOrganizationPlan ? 'organization' : 'user').catch(
                    (error) => {
                      alert(error instanceof Error ? error.message : t('errors.openBillingPortal'))
                    }
                  )
                }}
              >
                {t('actions.manage')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
