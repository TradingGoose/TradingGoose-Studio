'use client'

import { useCallback } from 'react'
import { ToolCase } from 'lucide-react'
import { parseImportedSkillsFile } from '@/lib/skills/import-export'
import {
  useUserPermissionsContext,
  WorkspacePermissionsProvider,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateSkill, useImportSkills } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useSkillsStore } from '@/stores/skills/store'
import type { SkillDefinition } from '@/stores/skills/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import {
  buildPersistedPairContext,
  SKILL_EDITOR_WIDGET_KEY,
  SKILL_LIST_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { SkillCreateMenu } from '@/widgets/widgets/list_skill/components/skill-create-menu'
import {
  SkillList,
  SkillListMessage,
} from '@/widgets/widgets/list_skill/components/skill-list/skill-list'

const DEFAULT_SKILL_NAME = 'New Skill'

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
  pairColor,
}: {
  workspaceId?: string | null
  panelId?: string
  pairColor?: PairColor
}) => {
  const permissions = useUserPermissionsContext()
  const createSkillMutation = useCreateSkill()
  const importMutation = useImportSkills()
  const storedSkills = useSkillsStore((state) =>
    workspaceId ? state.getAllSkills(workspaceId) : []
  )
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const handleCreateSkill = useCallback(() => {
    if (!workspaceId || !permissions.canEdit) return

    void createSkillMutation
      .mutateAsync({
        workspaceId,
        skill: buildNewSkillDraft(storedSkills),
      })
      .then((createdSkills) => {
        const createdSkill = createdSkills[0]
        const createdSkillId =
          createdSkill && typeof createdSkill.id === 'string' ? createdSkill.id : null

        if (!createdSkillId) {
          throw new Error('Created skill is missing an id')
        }

        if (isLinkedToColorPair) {
          setPairContext(
            resolvedPairColor,
            buildPersistedPairContext({
              existing: pairContext,
              legacyIdKey: 'skillId',
              descriptor: null,
              legacyEntityId: createdSkillId,
            })
          )
          return
        }

        emitSkillSelectionChange({
          skillId: createdSkillId,
          panelId,
          widgetKey: SKILL_LIST_WIDGET_KEY,
        })
        emitSkillSelectionChange({
          skillId: createdSkillId,
          panelId,
          widgetKey: SKILL_EDITOR_WIDGET_KEY,
        })
      })
      .catch((error) => {
        console.error('Failed to create skill from list widget', error)
      })
  }, [
    createSkillMutation,
    isLinkedToColorPair,
    pairContext,
    panelId,
    permissions.canEdit,
    resolvedPairColor,
    setPairContext,
    storedSkills,
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
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>Explorer</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId}>
      <div className={widgetHeaderButtonGroupClassName()}>
        <SkillListHeaderRight workspaceId={workspaceId} panelId={panelId} pairColor={pairColor} />
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
