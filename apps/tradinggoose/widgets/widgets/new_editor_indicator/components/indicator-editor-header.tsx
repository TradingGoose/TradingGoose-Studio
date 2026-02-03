'use client'

import { Check, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitIndicatorEditorAction } from '@/widgets/utils/indicator-editor-actions'
import { emitNewIndicatorSelectionChange } from '@/widgets/utils/new-indicator-selection'
import { PineIndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'

interface PineIndicatorEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  indicatorId?: string | null
  pairColor?: PairColor
  widgetKey?: string
}

export function PineIndicatorEditorSelector({
  workspaceId,
  panelId,
  indicatorId,
  pairColor = 'gray',
  widgetKey,
}: PineIndicatorEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? null)
    : (indicatorId ?? null)

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (isLinkedToColorPair) {
      if (pairContext?.pineIndicatorId === nextId) return
      setPairContext(resolvedPairColor, { pineIndicatorId: nextId })
      return
    }
    if (!widgetKey) return

    emitNewIndicatorSelectionChange({
      indicatorId: nextId,
      panelId,
      widgetKey,
    })
  }

  return (
    <PineIndicatorDropdown
      workspaceId={workspaceId}
      value={resolvedIndicatorId ? [resolvedIndicatorId] : []}
      onChange={handleIndicatorChange}
      placeholder='Select indicator'
      selectionMode='single'
      triggerClassName='min-w-[220px]'
    />
  )
}

interface PineIndicatorEditorSaveButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

export function PineIndicatorEditorSaveButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: PineIndicatorEditorSaveButtonProps) {
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
    ? (pairContext?.pineIndicatorId ?? null)
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

interface PineIndicatorEditorVerifyButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

export function PineIndicatorEditorVerifyButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: PineIndicatorEditorVerifyButtonProps) {
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
    ? (pairContext?.pineIndicatorId ?? null)
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
