'use client'

import { Check, Save } from 'lucide-react'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitIndicatorEditorAction } from '@/widgets/utils/indicator-editor-actions'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'
import {
  EntityEditorHeaderButton,
  EntityEditorRedoButton,
  EntityEditorUndoButton,
} from '@/widgets/widgets/components/entity-editor-buttons'
import {
  buildPersistedPairContext,
  readEntitySelectionState,
} from '@/widgets/widgets/editor_indicator/utils'

interface IndicatorEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  indicatorId?: string | null
  pairColor?: PairColor
  widgetKey?: string
  params?: Record<string, unknown> | null
}

export function IndicatorEditorSelector({
  workspaceId,
  panelId,
  indicatorId,
  pairColor = 'gray',
  widgetKey,
  params,
}: IndicatorEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (isLinkedToColorPair) {
      if (pairContext?.indicatorId === nextId) return
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'indicatorId',
          descriptor: null,
          legacyEntityId: nextId,
        })
      )
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
  params?: Record<string, unknown> | null
}

function useIndicatorSelection({
  indicatorId,
  pairColor = 'gray',
  params,
}: Pick<IndicatorEditorActionButtonProps, 'indicatorId' | 'pairColor' | 'params'>) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  return readEntitySelectionState({
    params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    legacyIdKey: 'indicatorId',
  })
}

function useHasIndicatorSelection(
  props: Pick<IndicatorEditorActionButtonProps, 'indicatorId' | 'pairColor' | 'params'>
) {
  const s = useIndicatorSelection(props)
  return !!s.legacyEntityId || !!s.reviewSessionId || !!s.reviewDraftSessionId
}

type IndicatorEditorAction = 'save' | 'verify' | 'undo' | 'redo'

/**
 * Internal parameterized button that powers save / verify / undo / redo.
 * All four share the same hook calls; only the rendered button differs.
 */
function IndicatorEditorActionButton({
  action,
  ...props
}: IndicatorEditorActionButtonProps & { action: IndicatorEditorAction }) {
  const selectionState = useIndicatorSelection(props)
  const hasSelection = useHasIndicatorSelection(props)
  const emitAction = () =>
    emitIndicatorEditorAction({ action, panelId: props.panelId, widgetKey: props.widgetKey })

  switch (action) {
    case 'save':
      return (
        <EntityEditorHeaderButton
          tooltip='Save indicator'
          label='Save indicator'
          icon={Save}
          disabled={!props.workspaceId || !hasSelection}
          variant='default'
          onClick={emitAction}
        />
      )
    case 'verify':
      return (
        <EntityEditorHeaderButton
          tooltip='Verify indicator'
          label='Verify indicator'
          icon={Check}
          disabled={!props.workspaceId || !hasSelection}
          variant='secondary'
          onClick={emitAction}
        />
      )
    case 'undo':
      return (
        <EntityEditorUndoButton
          reviewSessionId={selectionState.reviewSessionId}
          onAction={emitAction}
        />
      )
    case 'redo':
      return (
        <EntityEditorRedoButton
          reviewSessionId={selectionState.reviewSessionId}
          onAction={emitAction}
        />
      )
  }
}

export function IndicatorEditorSaveButton(props: IndicatorEditorActionButtonProps) {
  return <IndicatorEditorActionButton action='save' {...props} />
}

export function IndicatorEditorVerifyButton(props: IndicatorEditorActionButtonProps) {
  return <IndicatorEditorActionButton action='verify' {...props} />
}

export function IndicatorEditorUndoButton(props: IndicatorEditorActionButtonProps) {
  return <IndicatorEditorActionButton action='undo' {...props} />
}

export function IndicatorEditorRedoButton(props: IndicatorEditorActionButtonProps) {
  return <IndicatorEditorActionButton action='redo' {...props} />
}

/**
 * Consolidated header actions for the indicator editor.
 * Receives the shared props once and renders undo, redo, verify, and save buttons.
 */
export function IndicatorEditorHeaderActions(props: IndicatorEditorActionButtonProps) {
  return (
    <div className='flex items-center gap-1'>
      <IndicatorEditorUndoButton {...props} />
      <IndicatorEditorRedoButton {...props} />
      <IndicatorEditorVerifyButton {...props} />
      <IndicatorEditorSaveButton {...props} />
    </div>
  )
}
