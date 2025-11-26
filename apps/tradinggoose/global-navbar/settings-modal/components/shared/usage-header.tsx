'use client'

import type { ReactNode } from 'react'
import { Badge, Progress } from '@/components/ui'
import { cn } from '@/lib/utils'

const GRADIENT_BADGE_STYLES =
  'gradient-text h-[1.125rem] rounded-md border-gradient-primary from-gradient-primary via-gradient-secondary to-gradient-primary px-2 py-0 font-medium text-xs font-bold'

const USAGE_PILL_COUNT = 8
const calculateFilledPills = (percent: number) => {
  const clamped = Math.max(0, Math.min(percent, 100))
  const filled = Math.round((clamped / 100) * USAGE_PILL_COUNT)
  // Show at least one pill when there is any usage but rounding would yield 0
  return clamped > 0 && filled === 0 ? 1 : filled
}

interface UsageHeaderProps {
  title: string
  gradientTitle?: boolean
  showBadge?: boolean
  badgeText?: string
  onBadgeClick?: () => void
  rightContent?: ReactNode
  current: number
  limit: number
  progressValue?: number
  seatsText?: string
  isBlocked?: boolean
  onResolvePayment?: () => void
  status?: 'ok' | 'warning' | 'exceeded' | 'blocked'
  percentUsed?: number
}

export function UsageHeader({
  title,
  gradientTitle = false,
  showBadge = false,
  badgeText,
  onBadgeClick,
  rightContent,
  current,
  limit,
  progressValue,
  seatsText,
  isBlocked,
  onResolvePayment,
  status,
  percentUsed,
}: UsageHeaderProps) {
  const progress = progressValue ?? (limit > 0 ? Math.min((current / limit) * 100, 100) : 0)
  const filledPillsCount = calculateFilledPills(progress)
  const isAlmostOut = filledPillsCount === USAGE_PILL_COUNT
  const formattedLimit = Number.isFinite(limit) ? Number(limit).toFixed(2) : '0.00'

  return (
    <div className='rounded-md border bg-background p-3 shadow-xs'>
      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'font-medium text-sm',
                gradientTitle
                  ? 'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'
                  : 'text-foreground'
              )}
            >
              {title}
            </span>
            {showBadge && badgeText ? (
              <Badge className={GRADIENT_BADGE_STYLES} onClick={onBadgeClick}>
                {badgeText}
              </Badge>
            ) : null}
            {seatsText ? (
              <span className='text-muted-foreground text-xs'>({seatsText})</span>
            ) : null}
          </div>
          <div className='flex items-center gap-1 text-xs tabular-nums'>
            {isBlocked ? (
              <span className='text-muted-foreground'>Payment required</span>
            ) : (
              <>
                <span className='text-muted-foreground'>${current.toFixed(2)}</span>
                <span className='text-muted-foreground'>/</span>
                {rightContent ?? (
                  <span className='text-muted-foreground'>${formattedLimit}</span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Usage pills for clearer low-limit visualization */}
        <div className='flex items-center gap-1'>
          {Array.from({ length: USAGE_PILL_COUNT }).map((_, i) => {
            const isFilled = i < filledPillsCount
            return (
              <div
                key={i}
                className='h-1.5 flex-1 rounded-sm'
                style={{
                  backgroundColor: isFilled ? (isAlmostOut ? '#ef4444' : '#ffcc00') : '#88888825',
                }}
              />
            )
          })}
        </div>

        {isBlocked && (
          <div className='flex items-center justify-between rounded-md bg-destructive/10 px-2 py-1'>
            <span className='text-destructive text-xs'>
              Payment failed. Please update your payment method.
            </span>
            {onResolvePayment && (
              <button
                type='button'
                className='font-medium text-destructive text-xs underline underline-offset-2'
                onClick={onResolvePayment}
              >
                Resolve payment
              </button>
            )}
          </div>
        )}

        {!isBlocked && status === 'exceeded' && (
          <div className='rounded-[6px] bg-yellow-900/10 px-2 py-1'>
            <span className='text-yellow-600 text-xs'>
              Usage limit exceeded. Increase your limit to continue.
            </span>
          </div>
        )}

        {!isBlocked && status === 'warning' && (
          <div className='rounded-[6px] bg-yellow-900/10 px-2 py-1'>
            <span className='text-xs text-yellow-600'>
              {typeof percentUsed === 'number' ? `${percentUsed}%` : '80%+'} of your limit used.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
