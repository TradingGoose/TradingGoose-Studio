'use client'

import { Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitIndicatorEditorAction } from '@/widgets/utils/indicator-editor-actions'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'

interface IndicatorEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  indicatorId?: string | null
  pairColor?: PairColor
  widgetKey?: string
}

export function IndicatorEditorSelector({
  workspaceId,
  panelId,
  indicatorId,
  pairColor = 'gray',
  widgetKey,
}: IndicatorEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (isLinkedToColorPair) {
      if (pairContext?.pineIndicatorId === nextId) return
      setPairContext(resolvedPairColor, { pineIndicatorId: nextId })
      return
    }
    if (!widgetKey) return

    emitIndicatorSelectionChange({
      indicatorId: nextId,
      panelId,
      widgetKey,
    })
  }

  return (
    <IndicatorDropdown
      workspaceId={workspaceId}
      value={resolvedIndicatorId ? [resolvedIndicatorId] : []}
      onChange={handleIndicatorChange}
      placeholder='Select indicator'
      selectionMode='single'
      triggerClassName='min-w-[220px]'
    />
  )
}

interface IndicatorEditorActionButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

export function IndicatorEditorSaveButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)
  const saveDisabled = !workspaceId || !resolvedIndicatorId

  const handleSave = () => {
    emitIndicatorEditorAction({
      action: 'save',
      panelId,
      widgetKey,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='default'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className='h-4 w-4' />
            <span className='sr-only'>Save indicator</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Save indicator</TooltipContent>
    </Tooltip>
  )
}

export function IndicatorEditorVerifyButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)
  const verifyDisabled = !workspaceId || !resolvedIndicatorId

  const handleVerify = () => {
    emitIndicatorEditorAction({
      action: 'verify',
      panelId,
      widgetKey,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleVerify}
            disabled={verifyDisabled}
          >
            <Check className='h-4 w-4' />
            <span className='sr-only'>Verify indicator</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Verify indicator</TooltipContent>
    </Tooltip>
  )
}
