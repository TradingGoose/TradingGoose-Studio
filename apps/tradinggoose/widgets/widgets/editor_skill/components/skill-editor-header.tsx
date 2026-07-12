'use client'

import { Download, Save } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { emitSkillEditorAction } from '@/widgets/utils/skill-editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'

interface SkillEditorSelectorProps {
  workspaceId?: string
  skillId?: string | null
}

export function SkillEditorSelector({ workspaceId, skillId }: SkillEditorSelectorProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillEditor.header
  const actions = useWidgetConfigRuntimeActions()
  const resolvedSkillId = skillId ?? null

  const handleSkillChange = (nextSkillId: string | null) => {
    actions.patchWidgetLinkedParams?.({ skillId: nextSkillId })
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
  canEditEntity?: boolean
}

export function SkillEditorExportButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
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
