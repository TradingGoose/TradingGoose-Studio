'use client'

import { useMemo, useState } from 'react'
import { Eye, EyeOff, Settings2, Trash2, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import type { InputMetaMap } from '@/lib/indicators/types'
import { cn } from '@/lib/utils'
import type { IndicatorPlotValue } from '@/widgets/widgets/data_chart/hooks/use-indicator-legend'

type IndicatorControlProps = {
  indicatorId: string
  name: string
  inputMeta?: InputMetaMap | null
  indicatorInputs?: Record<string, unknown>
  plotValues?: IndicatorPlotValue[]
  isHidden: boolean
  errorMessage?: string
  onToggleHidden: (indicatorId: string) => void
  onRemove: (indicatorId: string) => void
  onOpenSettings: (indicatorId: string) => void
}

const controlButtonClass =
  'inline-flex p-0.5 items-center hover:bg-secondary justify-center rounded-xs bg-background text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-50'

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
  errorMessage,
  onToggleHidden,
  onRemove,
  onOpenSettings,
}: IndicatorControlProps) => {
  const [isHoveringData, setIsHoveringData] = useState(false)
  const [isErrorOpen, setIsErrorOpen] = useState(false)
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
  const hasError = Boolean(errorMessage?.trim())

  return (
    <div
      className={cn(
        'pointer-events-none inline-flex h-6 min-w-0 max-w-full self-start items-center gap-1 rounded-sm border border-border/40 bg-background/40 text-center text-xs shadow-xs backdrop-blur-sm',
        isHidden && 'opacity-60'
      )}
    >
      <div
        className='pointer-events-auto inline-flex min-w-0 shrink items-center gap-1'
        onMouseEnter={() => setIsHoveringData(true)}
        onMouseLeave={() => setIsHoveringData(false)}
      >
        <div className='min-w-0 inline-flex shrink items-center gap-1'>
          <div className='min-w-0 py-0.5 px-1'>
            <span className='block max-w-full text-center truncate font-semibold text-xs text-foreground'>
              {name}
            </span>
          </div>
          {!hasError && paramItems.length > 0 && (
            <div
              className={cn(
                'flex flex-nowrap min-w-0 max-w-full overflow-hidden p-0.5 items-center gap-1 text-xs text-muted-foreground'
              )}
            >
              {paramItems.map((item) => (
                <span key={`${indicatorId}-${item.title}`} className='min-w-0 shrink truncate'>
                  {item.value}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={cn('hidden items-center gap-1 p-0.5 pr-1', isHoveringData && 'flex')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={controlButtonClass}
                onClick={() => onToggleHidden(indicatorId)}
              >
                {isHidden ? <EyeOff className='h-3 w-3' /> : <Eye className='h-3 w-3' />}
                <span className='sr-only'>{isHidden ? 'Show indicator' : 'Hide indicator'}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='top'>{isHidden ? 'Show' : 'Hide'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={controlButtonClass}
                onClick={() => onOpenSettings(indicatorId)}
                disabled={!hasSettings}
              >
                <Settings2 className='h-3 w-3' />
                <span className='sr-only'>Indicator settings</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='top'>{hasSettings ? 'Settings' : 'No settings'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={controlButtonClass}
                onClick={() => onRemove(indicatorId)}
              >
                <Trash2 className='h-3 w-3' />
                <span className='sr-only'>Remove indicator</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='top'>Remove</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!hasError && plotValues && plotValues.length > 0 && (
        <div
          className={cn(
            'pointer-events-none flex min-w-0 max-w-full shrink flex-nowrap items-center gap-2 overflow-hidden p-0.5 text-xs text-muted-foreground',
            isHoveringData && 'hidden'
          )}
        >
          {plotValues.map((plot) => (
            <span
              key={`${indicatorId}-${plot.key}`}
              className='min-w-0 shrink truncate'
              style={plot.color ? { color: plot.color } : undefined}
            >
              {plotValues.length > 1 ? `${plot.title}: ` : ''}
              {plot.displayValue}
            </span>
          ))}
        </div>
      )}

      {hasError && (
        <div className='pointer-events-auto flex items-center gap-1 p-0.5'>
          <Dialog open={isErrorOpen} onOpenChange={setIsErrorOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <button
                    type='button'
                    className={cn(
                      controlButtonClass,
                      'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive'
                    )}
                  >
                    <TriangleAlert className='h-3 w-3' />
                    <span className='sr-only'>Indicator error</span>
                  </button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent side='top'>Indicator error</TooltipContent>
            </Tooltip>
            <DialogContent className='max-w-md p-0'>
              <div className='flex items-start gap-3 border-b border-border/60 px-5 py-4'>
                <div className='mt-0.5 flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive'>
                  <TriangleAlert className='h-4 w-4' />
                </div>
                <div className='min-w-0'>
                  <DialogTitle className='text-base'>Indicator error</DialogTitle>
                  <DialogDescription className='text-muted-foreground'>
                    {name} failed to compile.
                  </DialogDescription>
                </div>
              </div>
              <div className='px-5 py-4'>
                <div className='max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-[12px] text-destructive whitespace-pre-wrap break-words'>
                  {errorMessage}
                </div>
                <p className='mt-3 text-xs text-muted-foreground'>
                  Check the indicator inputs or script, then try again.
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  )
}
