'use client'

import { Download, Save } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import type { PairColor } from '@/widgets/pair-colors'
import { emitSkillEditorAction } from '@/widgets/utils/skill-editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
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
  const actions = useWidgetConfigRuntimeActions()
  const patchLinkedParams =
    pairColor === 'gray' ? actions.patchWidgetParams : actions.patchWidgetColorPair
  const resolvedSkillId = skillId ?? null

  const handleSkillChange = (nextSkillId: string | null) => {
    patchLinkedParams({ skillId: nextSkillId })
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
  canEditEntity?: boolean
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
  const resolvedSkillId = skillId ?? null
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
  canEditEntity = true,
}: SkillEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillEditor.header
  const resolvedSkillId = skillId ?? null
  const disabled = !canEditEntity || !workspaceId || !resolvedSkillId

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
