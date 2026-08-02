import { memo, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/app/workspace/[workspaceId]/records/utils'

export interface StatusBarSegment {
  successRate: number
  hasExecutions: boolean
  totalExecutions: number
  successfulExecutions: number
  timestamp: string
}

export function StatusBar({
  segments,
  selectedSegmentIndices,
  onSegmentClick,
  workflowId,
  segmentDurationMs,
  preferBelow = false,
}: {
  segments: StatusBarSegment[]
  selectedSegmentIndices: number[] | null
  onSegmentClick: (
    workflowId: string,
    index: number,
    timestamp: string,
    mode: 'single' | 'toggle' | 'range'
  ) => void
  workflowId: string
  segmentDurationMs: number
  preferBelow?: boolean
}) {
  const locale = useLocale()
  const t = useTranslations('workspace.logs.dashboard.workflows')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const labels = useMemo(() => {
    return segments.map((segment) => {
      const start = new Date(segment.timestamp)
      const end = new Date(start.getTime() + (segmentDurationMs || 0))
      const rangeLabel =
        Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
          ? ''
          : `${formatDate(start.toISOString(), locale).compactDate} ${formatDate(start.toISOString(), locale).compactTime} - ${formatDate(end.toISOString(), locale).compactTime}`
      return {
        rangeLabel,
        successLabel: `${segment.successRate.toFixed(1)}%`,
        countsLabel: t('succeeded', {
          success: segment.successfulExecutions ?? 0,
          total: segment.totalExecutions ?? 0,
          plural: segment.totalExecutions !== 1 ? 's' : '',
        }),
      }
    })
  }, [locale, segmentDurationMs, segments, t])

  return (
    <div className='relative'>
      <div
        className='flex select-none items-stretch gap-[2px]'
        onMouseLeave={() => setHoverIndex(null)}
      >
        {segments.map((segment, i) => {
          const isSelected = Array.isArray(selectedSegmentIndices)
            ? selectedSegmentIndices.includes(i)
            : false

          let color: string
          if (!segment.hasExecutions) {
            color =
              'bg-gray-300/60 hover:bg-gray-300/60 dark:bg-gray-500/40 dark:hover:bg-gray-500/40'
          } else if (segment.successRate === 100) {
            color = 'bg-emerald-400/90 hover:bg-emerald-400/90'
          } else if (segment.successRate >= 95) {
            color = 'bg-yellow-400/90 hover:bg-yellow-400/90'
          } else {
            color = 'bg-red-400/90 hover:bg-red-400/90'
          }

          return (
            <Button
              key={i}
              type='button'
              variant='ghost'
              aria-pressed={isSelected}
              aria-label={
                segment.hasExecutions
                  ? t('segmentWithExecutions', {
                      index: i + 1,
                      range: labels[i].rangeLabel || t('timeUnavailable'),
                      successRate: labels[i].successLabel,
                      counts: labels[i].countsLabel,
                    })
                  : t('segmentWithoutExecutions', {
                      index: i + 1,
                      range: labels[i].rangeLabel || t('timeUnavailable'),
                    })
              }
              className={`h-6 min-w-0 flex-1 rounded-xs p-0 ${color} transition-[opacity,transform] hover:opacity-90 ${
                isSelected ? 'relative z-10 ring-2 ring-primary ring-offset-1' : 'relative z-0'
              }`}
              onMouseEnter={() => setHoverIndex(i)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
              onClick={(e) => {
                const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single'
                onSegmentClick(workflowId, i, segment.timestamp, mode)
              }}
            />
          )
        })}
      </div>

      {hoverIndex !== null && segments[hoverIndex] && (
        <div
          className={`-translate-x-1/2 pointer-events-none absolute z-20 w-max whitespace-nowrap rounded-md bg-background/90 px-2 py-1 text-center text-[11px] shadow-sm ring-1 ring-border backdrop-blur ${
            preferBelow ? '' : '-translate-y-full'
          }`}
          style={{
            left: `${((hoverIndex + 0.5) / (segments.length || 1)) * 100}%`,
            top: preferBelow ? '100%' : 0,
            marginTop: preferBelow ? 8 : -8,
          }}
        >
          {segments[hoverIndex].hasExecutions ? (
            <div>
              <div className='font-semibold'>{labels[hoverIndex].successLabel}</div>
              <div className='text-muted-foreground'>{labels[hoverIndex].countsLabel}</div>
              {labels[hoverIndex].rangeLabel && (
                <div className='mt-0.5 text-muted-foreground'>{labels[hoverIndex].rangeLabel}</div>
              )}
            </div>
          ) : (
            <div className='text-muted-foreground'>{labels[hoverIndex].rangeLabel}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(StatusBar)
