'use client'

import { Save } from 'lucide-react'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitSkillEditorAction } from '@/widgets/utils/skill-editor-actions'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'
import {
  EntityEditorHeaderButton,
  EntityEditorRedoButton,
  EntityEditorUndoButton,
} from '@/widgets/widgets/components/entity-editor-buttons'
import {
  buildPersistedPairContext,
  readEntitySelectionState,
  SKILL_EDITOR_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'

interface SkillEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  skillId?: string | null
  pairColor?: PairColor
  widgetKey?: string
  params?: Record<string, unknown> | null
}

export function SkillEditorSelector({
  workspaceId,
  panelId,
  skillId,
  pairColor = 'gray',
  widgetKey,
  params,
}: SkillEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedSkillId = isLinkedToColorPair
    ? (pairContext?.skillId ?? skillId ?? null)
    : (skillId ?? null)

  const handleSkillChange = (nextSkillId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.skillId === nextSkillId) return
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'skillId',
          descriptor: null,
          legacyEntityId: nextSkillId,
        })
      )
      return
    }

    emitSkillSelectionChange({
      skillId: nextSkillId,
      panelId,
      widgetKey: widgetKey ?? SKILL_EDITOR_WIDGET_KEY,
    })
  }

  return (
    <SkillDropdown
      workspaceId={workspaceId}
      value={resolvedSkillId}
      onChange={handleSkillChange}
      placeholder='Select skill'
      triggerClassName='min-w-[240px]'
    />
  )
}

interface SkillEditorActionButtonProps {
  workspaceId?: string
  skillId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
  params?: Record<string, unknown> | null
}

export function SkillEditorSaveButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
  params,
}: SkillEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const selectionState = readEntitySelectionState({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
    legacyIdKey: 'skillId',
  })
  const resolvedSkillId = selectionState.legacyEntityId ?? skillId ?? null
  const saveDisabled =
    !workspaceId &&
    !resolvedSkillId &&
    !selectionState.reviewSessionId &&
    !selectionState.reviewDraftSessionId
  const disabled =
    !workspaceId ||
    (!resolvedSkillId &&
      !selectionState.reviewSessionId &&
      !selectionState.reviewDraftSessionId)

  return (
    <EntityEditorHeaderButton
      tooltip='Save skill'
      label='Save skill'
      icon={Save}
      disabled={disabled || saveDisabled}
      variant='default'
      onClick={() => emitSkillEditorAction({ action: 'save', panelId, widgetKey })}
    />
  )
}

export function SkillEditorUndoButton(props: SkillEditorActionButtonProps) {
  const resolvedPairColor = (props.pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  const selectionState = readEntitySelectionState({
    params: props.params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    legacyIdKey: 'skillId',
  })

  return (
    <EntityEditorUndoButton
      reviewSessionId={selectionState.reviewSessionId}
      onAction={() =>
        emitSkillEditorAction({ action: 'undo', panelId: props.panelId, widgetKey: props.widgetKey })
      }
    />
  )
}

export function SkillEditorRedoButton(props: SkillEditorActionButtonProps) {
  const resolvedPairColor = (props.pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  const selectionState = readEntitySelectionState({
    params: props.params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    legacyIdKey: 'skillId',
  })

  return (
    <EntityEditorRedoButton
      reviewSessionId={selectionState.reviewSessionId}
      onAction={() =>
        emitSkillEditorAction({ action: 'redo', panelId: props.panelId, widgetKey: props.widgetKey })
      }
    />
  )
}

/**
 * Consolidated header actions for the skill editor.
 * Receives the shared props once and renders undo, redo, and save buttons.
 */
export function SkillEditorHeaderActions(props: SkillEditorActionButtonProps) {
  return (
    <div className='flex items-center gap-1'>
      <SkillEditorUndoButton {...props} />
      <SkillEditorRedoButton {...props} />
      <SkillEditorSaveButton {...props} />
    </div>
  )
}
