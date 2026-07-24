'use client'

import { Download, Save } from 'lucide-react'
import { useMessages } from 'next-intl'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SKILL_EDITOR_ACTION_EVENT, type SkillEditorActionEventDetail } from '@/widgets/events'
import { emitEditorAction } from '@/widgets/utils/editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'

interface SkillEditorSelectorProps {
  workspaceId?: string
  skillId?: string | null
}

export function SkillEditorSelector({ workspaceId, skillId }: SkillEditorSelectorProps) {
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
}

export function SkillEditorActionButtons({
  workspaceId,
  skillId: requestedSkillId,
  panelId,
  widgetKey,
}: SkillEditorActionButtonProps) {
  const copy = useMessages().workspace.widgets.skillEditor.header
  const { canEdit } = useUserPermissionsContext()
  const { members } = useEntityList('skill', workspaceId)
  const resolvedSkillId = resolveEntityIdFromList({
    requestedEntityId: requestedSkillId,
    entityIds: members.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const exportDisabled = !workspaceId || !resolvedSkillId
  const saveDisabled = !canEdit || exportDisabled

  return (
    <>
      <EntityEditorHeaderButton
        tooltip={copy.exportSkill}
        label={copy.exportSkill}
        icon={Download}
        disabled={exportDisabled}
        onClick={() => {
          if (resolvedSkillId) {
            emitEditorAction<SkillEditorActionEventDetail>(SKILL_EDITOR_ACTION_EVENT, {
              action: 'export',
              entityId: resolvedSkillId,
              panelId,
              widgetKey,
            })
          }
        }}
      />
      <EntityEditorHeaderButton
        tooltip={copy.saveSkill}
        label={copy.saveSkill}
        icon={Save}
        disabled={saveDisabled}
        variant='default'
        onClick={() => {
          if (resolvedSkillId) {
            emitEditorAction<SkillEditorActionEventDetail>(SKILL_EDITOR_ACTION_EVENT, {
              action: 'save',
              entityId: resolvedSkillId,
              panelId,
              widgetKey,
            })
          }
        }}
      />
    </>
  )
}
