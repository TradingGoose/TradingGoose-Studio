'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { isUsageAtLimit, USAGE_PILL_COLORS } from '@/lib/subscription/usage-visualization'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { RotatingDigit } from './rotating-digit'

const logger = createLogger('UsageIndicator')

const MIN_PILL_COUNT = 6
const MAX_PILL_COUNT = 8
const MIN_CONTAINER_WIDTH = 232
const WIDTH_PER_PILL = 50
const PILL_ANIMATION_TICK_MS = 30
const PILLS_PER_SECOND = 1.8
const PILL_STEP_PER_TICK = (PILLS_PER_SECOND * PILL_ANIMATION_TICK_MS) / 1000

const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

interface UsageIndicatorProps {
  onClick?: () => void
}

export function UsageIndicator({ onClick }: UsageIndicatorProps) {
  const {
    loadData,
    getUsage,
    getSubscriptionStatus,
    getBillingStatus,
    canUpgrade,
    subscriptionData,
    isLoading,
  } = useSubscriptionStore()

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(MIN_CONTAINER_WIDTH)
  const [isHovered, setIsHovered] = useState(false)
  const [wavePosition, setWavePosition] = useState<number | null>(null)

  const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (!containerEl) return

    const updateWidth = () => {
      const rect = containerEl.getBoundingClientRect()
      if (rect.width && !Number.isNaN(rect.width)) {
        setContainerWidth(rect.width)
      }
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number' && !Number.isNaN(width)) {
        setContainerWidth(width)
      }
    })

    observer.observe(containerEl)
    return () => observer.disconnect()
  }, [containerEl])

  const pillCount = useMemo(() => {
    const widthDelta = containerWidth - MIN_CONTAINER_WIDTH
    const additionalPills = Math.floor(widthDelta / WIDTH_PER_PILL)
    const calculatedCount = MIN_PILL_COUNT + additionalPills
    return Math.max(MIN_PILL_COUNT, Math.min(MAX_PILL_COUNT, calculatedCount))
  }, [containerWidth])

  const usage = getUsage()
  const subscription = getSubscriptionStatus()
  const billingStatus = getBillingStatus()
  const isBlocked = billingStatus === 'blocked'
  const percentUsed = typeof usage.percentUsed === 'number' ? usage.percentUsed : 0
  const progressPercentage = Math.min(Math.max(percentUsed, 0), 100)

  const planType = subscription.isEnterprise
    ? 'enterprise'
    : subscription.isTeam
      ? 'team'
      : subscription.isPro
        ? 'pro'
        : 'free'

  const showUpgradeButton =
    (planType === 'free' || isBlocked || progressPercentage >= 80) &&
    planType !== 'enterprise' &&
    canUpgrade()

  const filledPillsCount = pillCount <= 0 ? 0 : Math.ceil((progressPercentage / 100) * pillCount)
  const atLimit = isUsageAtLimit(progressPercentage)
  const startAnimationIndex = pillCount === 0 ? 0 : Math.min(filledPillsCount, pillCount - 1)

  useEffect(() => {
    if (!isHovered || pillCount <= 0) {
      setWavePosition(null)
      return
    }

    const maxDistance = Math.max(0, pillCount - startAnimationIndex)
    setWavePosition(0)

    const interval = window.setInterval(() => {
      setWavePosition((prev) => {
        const current = prev ?? 0
        if (current >= maxDistance) {
          return current
        }
        const next = current + PILL_STEP_PER_TICK
        return next >= maxDistance ? maxDistance : next
      })
    }, PILL_ANIMATION_TICK_MS)

    return () => window.clearInterval(interval)
  }, [isHovered, pillCount, startAnimationIndex])

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick()
      return
    }

    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
        logger.info('Opened subscription settings from usage indicator', {
          plan: subscription.plan,
          billingBlocked: subscriptionData?.billingBlocked,
        })
      }
    } catch (error) {
      logger.error('Failed to open subscription settings from usage indicator', { error })
    }
  }, [onClick, subscription.plan, subscriptionData?.billingBlocked])

  const formattedLimit =
    typeof usage.limit === 'number' && Number.isFinite(usage.limit)
      ? usage.limit.toFixed(2)
      : '--'

  const containerClasses = cn(
    'group flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    isBlocked
      ? 'border-destructive/50 bg-destructive/10 focus-visible:ring-destructive/40'
      : 'border-border/60 bg-card/60 hover:bg-card'
  )

  if (isLoading) {
    return (
      <div
        ref={handleContainerRef}
        className='flex flex-col gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2.5 shadow-sm'
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-4 w-16 rounded-sm' />
            <Skeleton className='h-4 w-20 rounded-sm' />
          </div>
          <Skeleton className='h-3 w-16 rounded-sm' />
        </div>
        <div className='flex items-center gap-1'>
          {Array.from({ length: Math.max(pillCount, MIN_PILL_COUNT) }).map((_, index) => (
            <Skeleton key={index} className='h-[6px] flex-1 rounded-full' />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={handleContainerRef}
      role='button'
      tabIndex={0}
      className={containerClasses}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleClick()
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className='flex items-center justify-between'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='flex-shrink-0 text-foreground text-[12px] font-semibold uppercase tracking-wide'>
            {PLAN_NAMES[planType]}
          </span>
          <div className='h-3 w-px flex-shrink-0 bg-border/60' />
          <div className='flex min-w-0 flex-1 items-center gap-1 text-[12px]'>
            {isBlocked ? (
              <span className='font-medium text-destructive'>Payment Required</span>
            ) : (
              <>
                <div className='flex items-center text-muted-foreground'>
                  <span className='mr-px'>$</span>
                  <RotatingDigit
                    value={Number.isFinite(usage.current) ? usage.current : 0}
                    height={14}
                    width={7}
                    textClassName='font-medium text-[12px] text-muted-foreground tabular-nums'
                  />
                </div>
                <span className='font-medium text-muted-foreground'>/</span>
                <span className='font-medium text-muted-foreground tabular-nums'>
                  ${formattedLimit}
                </span>
              </>
            )}
          </div>
        </div>
        {showUpgradeButton ? (
          <Button
            type='button'
            variant='ghost'
            className={cn(
              '-mx-1 h-auto px-2 py-0 text-[11px] font-medium transition-colors',
              isBlocked
                ? 'text-destructive hover:text-destructive/80'
                : 'text-primary hover:text-primary/80'
            )}
            onClick={(event) => {
              event.stopPropagation()
              handleClick()
            }}
          >
            {isBlocked ? 'Fix Now' : 'Upgrade'}
          </Button>
        ) : null}
      </div>

      <div className='flex items-center gap-1'>
        {Array.from({ length: pillCount }).map((_, index) => {
          const isFilled = index < filledPillsCount
          const baseColor = isFilled
            ? isBlocked || atLimit
              ? USAGE_PILL_COLORS.AT_LIMIT
              : USAGE_PILL_COLORS.FILLED
            : USAGE_PILL_COLORS.UNFILLED

          let backgroundColor = baseColor
          let backgroundImage: string | undefined

          if (isHovered && wavePosition !== null && pillCount > 0) {
            const grayColor = USAGE_PILL_COLORS.UNFILLED
            const activeColor = atLimit ? USAGE_PILL_COLORS.AT_LIMIT : USAGE_PILL_COLORS.FILLED
            const headIndex = Math.floor(wavePosition)
            const progress = wavePosition - headIndex
            const pillOffsetFromStart = index - startAnimationIndex

            if (pillOffsetFromStart < 0) {
              // keep default color
            } else if (pillOffsetFromStart < headIndex) {
              backgroundColor = isFilled ? baseColor : grayColor
              backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} 100%)`
            } else if (pillOffsetFromStart === headIndex) {
              const fillPercent = Math.max(0, Math.min(1, progress)) * 100
              const trailingColor = isFilled ? baseColor : grayColor
              backgroundColor = trailingColor
              backgroundImage = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPercent}%, ${trailingColor} ${fillPercent}%, ${trailingColor} 100%)`
            } else {
              backgroundColor = isFilled ? baseColor : grayColor
            }
          }

          return (
            <div
              key={index}
              className='h-[6px] flex-1 rounded-full'
              style={{
                backgroundColor,
                backgroundImage,
                transition: isHovered ? 'none' : 'background-color 200ms ease',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
