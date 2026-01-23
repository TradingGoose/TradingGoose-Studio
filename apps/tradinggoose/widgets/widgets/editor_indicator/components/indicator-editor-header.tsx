'use client'

import { Button } from '@/components/ui/button'
import { Check, Save } from 'lucide-react'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { IndicatorDropdown } from '@/widgets/widgets/components/indicator-dropdown'
import { emitIndicatorEditorAction } from '@/widgets/utils/indicator-editor-actions'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'

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

  const resolvedIndicatorId = isLinkedToColorPair
    ? pairContext?.indicatorId ?? null
    : indicatorId ?? null

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (isLinkedToColorPair) return

    emitIndicatorSelectionChange({
      indicatorId: nextId,
      panelId,
      widgetKey,
    })
  }

  return (
    <IndicatorDropdown
      workspaceId={workspaceId}
      widgetKey={widgetKey}
      pairColor={resolvedPairColor}
      value={resolvedIndicatorId ? [resolvedIndicatorId] : []}
      onChange={handleIndicatorChange}
      selectionMode='single'
      placeholder='Select indicator'
      triggerClassName='min-w-[220px]'
      allowDrafts
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

  const handleSave = () => {
    emitIndicatorEditorAction({
      action: 'save',
      panelId,
      widgetKey,
    })
  }

  const resolvedIndicatorId = isLinkedToColorPair
    ? pairContext?.indicatorId ?? null
    : indicatorId ?? null
  const saveDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <Button
      type='button'
      variant='default'
      size='sm'
      className='h-7 w-7  text-xs'
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

  const handleVerify = () => {
    emitIndicatorEditorAction({
      action: 'verify',
      panelId,
      widgetKey,
    })
  }

  const resolvedIndicatorId = isLinkedToColorPair
    ? pairContext?.indicatorId ?? null
    : indicatorId ?? null
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
