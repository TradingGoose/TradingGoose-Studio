'use client'

import { useCallback, useRef, useState } from 'react'
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
import { createSkill, importSkills } from '@/hooks/queries/skills'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { usePendingEntitySelection } from '@/widgets/utils/use-pending-entity-selection'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import {
  SkillCreateMenu,
  type SkillMenuAction,
} from '@/widgets/widgets/list_skill/components/skill-create-menu'
import {
  SkillList,
  SkillListMessage,
} from '@/widgets/widgets/list_skill/components/skill-list/skill-list'
import { skillListWidgetContract } from '@/widgets/widgets/list_skill/contract'

const SkillListHeaderRight = ({
  workspaceId,
  panelId,
}: {
  workspaceId?: string | null
  panelId?: string
}) => {
  const copy = useMessages().workspace.widgets
  const permissions = useUserPermissionsContext()
  const actionLockRef = useRef(false)
  const [activeAction, setActiveAction] = useState<SkillMenuAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const actions = useWidgetConfigRuntimeActions()
  const { members } = useEntityList('skill', workspaceId)

  const selectSkill = useCallback(
    (createdSkillId: string) => {
      actions.patchWidgetLinkedParams?.({ skillId: createdSkillId })
    },
    [actions]
  )
  const selectSkillWhenListed = usePendingEntitySelection(members, selectSkill)

  const handleCreateSkill = useCallback(() => {
    if (!workspaceId || !permissions.canEdit || actionLockRef.current) return

    actionLockRef.current = true
    setActiveAction('create')
    setActionError(null)
    void createSkill({
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
        const createdSkillId = createdSkills[0]?.id
        if (!createdSkillId) throw new Error('Created skill is missing an id')
        selectSkillWhenListed(createdSkillId)
      })
      .catch((error) => {
        console.error('Failed to create skill from list widget', error)
        setActionError(copy.skillList.createMenu.createFailed)
      })
      .finally(() => {
        actionLockRef.current = false
        setActiveAction(null)
      })
  }, [
    copy.skillEditor.defaults.content,
    copy.skillEditor.defaults.description,
    copy.skillEditor.defaults.name,
    copy.skillList.createMenu.createFailed,
    members,
    permissions.canEdit,
    selectSkillWhenListed,
    workspaceId,
  ])

  const handleImportSkills = useCallback(
    async (file: File) => {
      if (!workspaceId || !permissions.canEdit || actionLockRef.current) return

      actionLockRef.current = true
      setActiveAction('import')
      setActionError(null)
      try {
        const content = await file.text()
        const parsedFile = JSON.parse(content) as unknown
        parseImportedSkillsFile(parsedFile)
        await importSkills({
          workspaceId,
          file: parsedFile,
        })
      } catch (error) {
        console.error('Failed to import skills', error)
        setActionError(copy.skillList.createMenu.importFailed)
      } finally {
        actionLockRef.current = false
        setActiveAction(null)
      }
    },
    [copy.skillList.createMenu.importFailed, permissions.canEdit, workspaceId]
  )

  return (
    <SkillCreateMenu
      disabled={!workspaceId || !permissions.canEdit}
      activeAction={activeAction}
      error={actionError}
      onCreateSkill={handleCreateSkill}
      onImportSkills={handleImportSkills}
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
  const copy = useMessages().workspace.widgets.skillList
  if (!workspaceId) {
    return <span className='text-muted-foreground text-xs'>{copy.header.explorer}</span>
  }

  return (
    <WorkspacePermissionsProvider workspaceId={workspaceId} inheritUser>
      <div className={widgetHeaderButtonGroupClassName()}>
        <SkillListHeaderRight workspaceId={workspaceId} panelId={panelId} />
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
  contract: skillListWidgetContract,
  icon: ToolCase,
  component: (props) => <ListSkillWidgetBody {...props} />,
  renderHeader: ({ context, panelId }) => {
    return {
      right: <ListSkillHeaderRight workspaceId={context?.workspaceId} panelId={panelId} />,
    }
  },
}
