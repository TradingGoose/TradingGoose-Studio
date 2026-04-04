'use client'

import { useCallback } from 'react'
import { ToolCase } from 'lucide-react'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateSkill } from '@/hooks/queries/skills'
import { useSkillsStore } from '@/stores/skills/store'
import type { SkillDefinition } from '@/stores/skills/types'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { SkillCreateMenu } from '@/widgets/widgets/list_skill/components/skill-create-menu'
import {
  SkillList,
  SkillListMessage,
} from '@/widgets/widgets/list_skill/components/skill-list/skill-list'
import { SKILL_EDITOR_WIDGET_KEY } from '@/widgets/widgets/_shared/skill/utils'

const DEFAULT_SKILL_NAME = 'new-skill'

const buildNewSkillDraft = (skills: SkillDefinition[]) => {
  const existingNames = new Set(
    skills.map((skill) => skill.name.trim()).filter((name) => name.length > 0)
  )

  let nextName = DEFAULT_SKILL_NAME
  let suffix = 2

  while (existingNames.has(nextName)) {
    nextName = `${DEFAULT_SKILL_NAME}-${suffix}`
    suffix += 1
  }

  return {
    name: nextName,
    description: 'Describe what this skill does.',
    content: 'Add skill instructions here.',
  }
}

const SkillListHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  const createMutation = useCreateSkill()
  const permissions = useUserPermissionsContext()
  const storedSkills = useSkillsStore((state) =>
    workspaceId ? state.getAllSkills(workspaceId) : []
  )

  const handleCreateSkill = useCallback(async () => {
    if (!workspaceId || createMutation.isPending || !permissions.canEdit) return

    try {
      const response = await createMutation.mutateAsync({
        workspaceId,
        skill: buildNewSkillDraft(storedSkills),
      })
      const created = Array.isArray(response) ? response[0] : null
      if (!created?.id) return

      emitSkillSelectionChange({
        skillId: created.id,
        panelId,
        widgetKey: SKILL_EDITOR_WIDGET_KEY,
      })
    } catch (error) {
      console.error('Failed to create skill', error)
    }
  }, [createMutation, panelId, permissions.canEdit, storedSkills, workspaceId])

  return (
    <SkillCreateMenu
      disabled={!workspaceId || createMutation.isPending || !permissions.canEdit}
      onCreateSkill={handleCreateSkill}
    />
  )
}

const ListSkillHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className={widgetHeaderButtonGroupClassName()}>
        <SkillListHeaderRight workspaceId={workspaceId} panelId={panelId} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListSkillWidgetBody = (props: WidgetComponentProps) => {
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <SkillListMessage message='Select a workspace to browse its skills.' />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <SkillList {...props} />
    </WorkspacePermissionsProvider>
  )
}

export const listSkillWidget: DashboardWidgetDefinition = {
  key: 'list_skill',
  title: 'Skill List',
  icon: ToolCase,
  category: 'list',
  description: 'Browse and manage workspace skills.',
  component: (props) => <ListSkillWidgetBody {...props} />,
  renderHeader: ({ context, panelId }) => {
    return {
      right: <ListSkillHeaderRight workspaceId={context?.workspaceId} panelId={panelId} />,
    }
  },
}
