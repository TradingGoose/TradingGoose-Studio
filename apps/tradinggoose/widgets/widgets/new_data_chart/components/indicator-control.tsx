'use client'

import { useMemo } from 'react'
import { Eye, EyeOff, Settings2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InputMetaMap } from '@/lib/new_indicators/types'
import { buildInputsMapFromMeta } from '@/lib/new_indicators/input-meta'
import type { IndicatorPlotValue } from '@/widgets/widgets/new_data_chart/hooks/use-indicator-legend'

type IndicatorControlProps = {
  indicatorId: string
  name: string
  inputMeta?: InputMetaMap | null
  indicatorInputs?: Record<string, unknown>
  plotValues?: IndicatorPlotValue[]
  isHidden: boolean
  onToggleHidden: (indicatorId: string) => void
  onRemove: (indicatorId: string) => void
  onOpenSettings: (indicatorId: string) => void
}

const controlButtonClass =
  'inline-flex p-1 items-center justify-center rounded-sm border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50'

const formatInputValue = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (value == null) return '--'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const IndicatorControl = ({
  indicatorId,
  name,
  inputMeta,
  indicatorInputs,
  plotValues,
  isHidden,
  onToggleHidden,
  onRemove,
  onOpenSettings,
}: IndicatorControlProps) => {
  const inputEntries = useMemo(() => {
    if (!inputMeta) return []
    return Object.entries(inputMeta).map(([title, meta]) => ({ title, meta }))
  }, [inputMeta])

  const resolvedInputs = useMemo(
    () => buildInputsMapFromMeta(inputMeta ?? undefined, indicatorInputs ?? undefined),
    [inputMeta, indicatorInputs]
  )

  const paramItems = useMemo(
    () =>
      Object.entries(resolvedInputs).map(([title, value]) => ({
        title,
        value: formatInputValue(value),
      })),
    [resolvedInputs]
  )

  const hasSettings = inputEntries.length > 0

  return (
    <div
      className={cn(
        'group p-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-sm border border-border/40 text-center text-xs shadow-xs backdrop-blur',
        isHidden && 'opacity-60'
      )}
    >
      <div className='min-w-0 p-1'>
        <span className='h-3.5 font-semibold text-xs text-foreground'>{name}</span>
      </div>
      <div className='min-w-0 flex flex-col-2 p-1 gap-1'>
        {paramItems.length > 0 && (
          <div className='flex h-3.5 flex-wrap items-center gap-1 text-xs text-muted-foreground'>
            {paramItems.map((item) => (
              <span key={`${indicatorId}-${item.title}`} className='truncate'>
                {item.value}
              </span>
            ))}
          </div>
        )}
        {plotValues && plotValues.length > 0 && (
          <div className='flex h-3.5 flex-wrap items-center gap-2 text-xs text-muted-foreground group-hover:hidden'>
            {plotValues.map((plot) => (
              <span
                key={`${indicatorId}-${plot.key}`}
                className='truncate'
                style={plot.color ? { color: plot.color } : undefined}
              >
                {plotValues.length > 1 ? `${plot.title}: ` : ''}
                {plot.displayValue}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className='hidden items-center mr-1 gap-1 group-hover:flex'>
        <button
          type='button'
          className={controlButtonClass}
          onClick={() => onToggleHidden(indicatorId)}
          title={isHidden ? 'Show' : 'Hide'}
        >
          {isHidden ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
          <span className='sr-only'>{isHidden ? 'Show indicator' : 'Hide indicator'}</span>
        </button>
        <button
          type='button'
          className={controlButtonClass}
          onClick={() => onOpenSettings(indicatorId)}
          disabled={!hasSettings}
          title={hasSettings ? 'Settings' : 'No settings'}
        >
          <Settings2 className='h-3.5 w-3.5' />
          <span className='sr-only'>Indicator settings</span>
        </button>
        <button
          type='button'
          className={controlButtonClass}
          onClick={() => onRemove(indicatorId)}
          title='Remove'
        >
          <Trash2 className='h-3.5 w-3.5' />
          <span className='sr-only'>Remove indicator</span>
        </button>
      </div>
    </div>
  )
}
