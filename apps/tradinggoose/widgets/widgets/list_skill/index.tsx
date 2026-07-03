'use client'

import { useCallback } from 'react'
import { ToolCase } from 'lucide-react'
import { useMessages } from 'next-intl'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { generateAvailableName } from '@/lib/naming'
import { parseImportedSkillsFile } from '@/lib/skills/import-export'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateSkill, useImportSkills } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { SKILL_LIST_WIDGET_KEY } from '@/widgets/widgets/_shared/skill/utils'
import { SkillCreateMenu } from '@/widgets/widgets/list_skill/components/skill-create-menu'
import {
  SkillList,
  SkillListMessage,
} from '@/widgets/widgets/list_skill/components/skill-list/skill-list'

const SkillListHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const copy = useMessages().workspace.widgets
  const permissions = useUserPermissionsContext()
  const createSkillMutation = useCreateSkill()
  const importMutation = useImportSkills()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { members } = useEntityList('skill', workspaceId)

  const selectSkill = useCallback(
    (createdSkillId: string) => {
      if (isLinkedToColorPair) {
        setPairContext(resolvedPairColor, { skillId: createdSkillId })
        return
      }

      emitSkillSelectionChange({
        skillId: createdSkillId,
        panelId,
        widgetKey: SKILL_LIST_WIDGET_KEY,
      })
    },
    [isLinkedToColorPair, panelId, resolvedPairColor, setPairContext]
  )
  const selectSkillWhenListed = usePendingEntitySelection(members, selectSkill)

  const handleCreateSkill = useCallback(() => {
    if (!workspaceId || !permissions.canEdit) return

    void createSkillMutation
      .mutateAsync({
        workspaceId,
        skill: {
          name: generateAvailableName(
            members.map((member) => member.entityName),
            copy.skillEditor.defaults.name
          ),
          description: copy.skillEditor.defaults.description,
          content: copy.skillEditor.defaults.content,
        },
      })
      .then((createdSkills) => {
        const createdSkill = createdSkills[0]
        const createdSkillId =
          createdSkill && typeof createdSkill.id === 'string' ? createdSkill.id : null

        if (!createdSkillId) {
          throw new Error('Created skill is missing an id')
        }

        selectSkillWhenListed(createdSkillId)
      })
      .catch((error) => {
        console.error('Failed to create skill from list widget', error)
      })
  }, [
    createSkillMutation,
    copy.skillEditor.defaults.content,
    copy.skillEditor.defaults.description,
    copy.skillEditor.defaults.name,
    members,
    permissions.canEdit,
    selectSkillWhenListed,
    workspaceId,
  ])

  const handleImportSkills = useCallback(
    async (content: string) => {
      if (!workspaceId || importMutation.isPending || !permissions.canEdit) return

      try {
        const parsedFile = JSON.parse(content) as unknown
        parseImportedSkillsFile(parsedFile)
        await importMutation.mutateAsync({
          workspaceId,
          file: parsedFile,
        })
      } catch (error) {
        console.error('Failed to import skills', error)
      }
    },
    [importMutation, permissions.canEdit, workspaceId]
  )

  return (
    <SkillCreateMenu
      disabled={!workspaceId || !permissions.canEdit || createSkillMutation.isPending}
      canCreate={!createSkillMutation.isPending && permissions.canEdit}
      canImport={Boolean(workspaceId && permissions.canEdit)}
      isImporting={importMutation.isPending}
      onCreateSkill={handleCreateSkill}
      onImportSkills={handleImportSkills}
    />
  )
}

const ListSkillHeaderRight = ({
  workspaceId,
  panelId,
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const copy = useMessages().workspace.widgets.skillList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <SkillListHeaderRight workspaceId={workspaceId} panelId={panelId} pairColor={pairColor} />
      </div>
    </WorkspacePermissionsProvider>
  )
}

const ListSkillWidgetBody = (props: WidgetComponentProps) => {
  const copy = useMessages().workspace.widgets.skillList
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <SkillListMessage message={copy.body.selectWorkspace} />
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
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
  renderHeader: ({ widget, context, panelId }) => {
    return {
      right: (
        <ListSkillHeaderRight
          workspaceId={context?.workspaceId}
          panelId={panelId}
          pairColor={widget?.pairColor}
        />
      ),
    }
  },
}
