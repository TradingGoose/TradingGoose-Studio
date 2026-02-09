'use client'

import { Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
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

  const fallbackIndicatorId = pairContext?.pineIndicatorId
    ? null
    : (pairContext?.indicatorId ?? null)
  const fallbackIndicator = useIndicatorsStore((state) =>
    fallbackIndicatorId
      ? state.getIndicator(fallbackIndicatorId, workspaceId ?? undefined)
      : undefined
  )

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? (fallbackIndicator ? fallbackIndicatorId : null))
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

interface IndicatorEditorSaveButtonProps {
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
}: IndicatorEditorSaveButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const fallbackIndicatorId = pairContext?.pineIndicatorId
    ? null
    : (pairContext?.indicatorId ?? null)
  const fallbackIndicator = useIndicatorsStore((state) =>
    fallbackIndicatorId
      ? state.getIndicator(fallbackIndicatorId, workspaceId ?? undefined)
      : undefined
  )

  const handleSave = () => {
    emitIndicatorEditorAction({
      action: 'save',
      panelId,
      widgetKey,
    })
  }

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? (fallbackIndicator ? fallbackIndicatorId : null))
    : (indicatorId ?? null)
  const saveDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <Button
      type='button'
      variant='default'
      size='sm'
      className='h-7 w-7 text-xs'
      onClick={handleSave}
      disabled={saveDisabled}
    >
      <Save />
    </Button>
  )
}

interface IndicatorEditorVerifyButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

export function IndicatorEditorVerifyButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorVerifyButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const fallbackIndicatorId = pairContext?.pineIndicatorId
    ? null
    : (pairContext?.indicatorId ?? null)
  const fallbackIndicator = useIndicatorsStore((state) =>
    fallbackIndicatorId
      ? state.getIndicator(fallbackIndicatorId, workspaceId ?? undefined)
      : undefined
  )

  const handleVerify = () => {
    emitIndicatorEditorAction({
      action: 'verify',
      panelId,
      widgetKey,
    })
  }

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? (fallbackIndicator ? fallbackIndicatorId : null))
    : (indicatorId ?? null)
  const verifyDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <Button
      type='button'
      variant='secondary'
      size='sm'
      className='h-7 w-7 text-xs'
      onClick={handleVerify}
      disabled={verifyDisabled}
      title='Verify indicator'
    >
      <Check />
    </Button>
  )
}
