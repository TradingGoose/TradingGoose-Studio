'use client'

import { Download, Save } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useMessages } from 'next-intl'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitSkillEditorAction } from '@/widgets/utils/skill-editor-actions'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import {
  readEntitySelectionState,
  SKILL_EDITOR_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'

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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedSkillId = isLinkedToColorPair ? (pairContext?.skillId ?? null) : (skillId ?? null)

  const handleSkillChange = (nextSkillId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.skillId === nextSkillId) return
      setPairContext(resolvedPairColor, { skillId: nextSkillId })
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
      placeholder={copy.selectSkill}
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

export function SkillEditorExportButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: SkillEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedSkillId = isLinkedToColorPair ? (pairContext?.skillId ?? null) : (skillId ?? null)
  const exportDisabled = !workspaceId || !resolvedSkillId

  return (
    <EntityEditorHeaderButton
      tooltip={copy.exportSkill}
      label={copy.exportSkill}
      icon={Download}
      disabled={exportDisabled}
      onClick={() => emitSkillEditorAction({ action: 'export', panelId, widgetKey })}
    />
  )
}

export function SkillEditorSaveButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
  params,
}: SkillEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const selectionState = readEntitySelectionState({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
    entityIdKey: 'skillId',
  })
  const resolvedSkillId = selectionState.selectedEntityId ?? skillId ?? null
  const disabled = !workspaceId || !resolvedSkillId

  return (
    <EntityEditorHeaderButton
      tooltip={copy.saveSkill}
      label={copy.saveSkill}
      icon={Save}
      disabled={disabled}
      variant='default'
      onClick={() => emitSkillEditorAction({ action: 'save', panelId, widgetKey })}
    />
  )
}
