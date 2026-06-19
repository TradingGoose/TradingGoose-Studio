'use client'

import { useCallback } from 'react'
import { ToolCase } from 'lucide-react'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useLocale } from 'next-intl'
import { parseImportedSkillsFile } from '@/lib/skills/import-export'
import {
  useUserPermissionsContext,
} from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useCreateSkill, useImportSkills } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useSkillsStore } from '@/stores/skills/store'
import type { SkillDefinition } from '@/stores/skills/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import {
  SKILL_EDITOR_WIDGET_KEY,
  SKILL_LIST_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import { useMessages } from 'next-intl'
import { SkillCreateMenu } from '@/widgets/widgets/list_skill/components/skill-create-menu'
import {
  SkillList,
  SkillListMessage,
} from '@/widgets/widgets/list_skill/components/skill-list/skill-list'

const buildNewSkillDraft = (
  skills: SkillDefinition[],
  defaults: { name: string; description: string; content: string }
) => {
  const existingNames = new Set(
    skills.map((skill) => skill.name.trim()).filter((name) => name.length > 0)
  )

  let nextName = defaults.name
  let suffix = 2

  while (existingNames.has(nextName)) {
    nextName = `${defaults.name}-${suffix}`
    suffix += 1
  }

  return {
    name: nextName,
    description: defaults.description,
    content: defaults.content,
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets
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
        skill: buildNewSkillDraft(storedSkills, copy.skillEditor.defaults),
      })
      .then((createdSkills) => {
        const createdSkill = createdSkills[0]
        const createdSkillId =
          createdSkill && typeof createdSkill.id === 'string' ? createdSkill.id : null

        if (!createdSkillId) {
          throw new Error('Created skill is missing an id')
        }

        if (isLinkedToColorPair) {
          setPairContext(resolvedPairColor, { skillId: createdSkillId })
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <SkillListHeaderRight workspaceId={workspaceId} panelId={panelId} pairColor={pairColor} />
    </div>
  )
}

const ListSkillWidgetBody = (props: WidgetComponentProps) => {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.skillList
  const workspaceId = props.context?.workspaceId ?? null
  if (!workspaceId) {
    return <SkillListMessage message={copy.body.selectWorkspace} />
  }

  return <SkillList {...props} />
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
