'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import type { SkillDefinition } from '@/lib/skills/types'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useDeleteSkill } from '@/hooks/queries/skills'
import { formatTemplate } from '@/i18n/utils'
import type { WidgetComponentProps } from '@/widgets/types'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { SkillListItem } from '@/widgets/widgets/_shared/skill/components/skill-list-item'
import { normalizeSkillName, resolveSkillId } from '@/widgets/widgets/_shared/skill/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

export const SkillListMessage = WidgetStateMessage

export function SkillList({ context, params, onWidgetLinkedParamsPatch }: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.skillList
  const skillValidationCopy = useMessages().workspace.widgets.skillEditor.validation
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { members, isLoading, error } = useEntityList('skill', workspaceId)
  const deleteMutation = useDeleteSkill()
  const listSkills = useMemo<SkillDefinition[]>(
    () =>
      workspaceId
        ? members.map((member) => ({
            id: member.entityId,
            workspaceId,
            userId: null,
            name: member.entityName,
            description: '',
            content: '',
          }))
        : [],
    [members, workspaceId]
  )

  const requestedSkillId = resolveSkillId({
    params,
  })
  const selectedSkillId = resolveEntityIdFromList({
    requestedEntityId: requestedSkillId,
    entityIds: listSkills.map((skill) => skill.id),
    useDefaultEntity: false,
  })
  const handleSelect = useCallback(
    (skillId: string | null) => {
      onWidgetLinkedParamsPatch?.({ skillId })
    },
    [onWidgetLinkedParamsPatch]
  )

  const handleDelete = useCallback(
    async (skillId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!skillId) return

      setDeletingIds((prev) => new Set(prev).add(skillId))

      try {
        await deleteMutation.mutateAsync({ workspaceId, skillId })
        if (selectedSkillId === skillId) handleSelect(null)
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev)
          next.delete(skillId)
          return next
        })
      }
    },
    [deleteMutation, handleSelect, permissions.canEdit, selectedSkillId, workspaceId]
  )

  const handleRename = useCallback(
    async (skillId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return

      const normalizedName = normalizeSkillName(name)
      if (!normalizedName) {
        throw new Error(skillValidationCopy.nameRequired)
      }

      if (normalizedName.length > SKILL_NAME_MAX_LENGTH) {
        throw new Error(
          formatTemplate(skillValidationCopy.nameTooLong, { max: SKILL_NAME_MAX_LENGTH })
        )
      }

      await renameSavedEntityAction({
        entityKind: 'skill',
        entityId: skillId,
        workspaceId,
        name: normalizedName,
      })
    },
    [permissions.canEdit, skillValidationCopy, workspaceId]
  )

  if (isLoading && listSkills.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error && listSkills.length === 0) {
    return <SkillListMessage message={error || copy.body.failedToLoadSkills} />
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listSkills.length === 0 ? (
        <SkillListMessage message={copy.body.noSkillsYet} />
      ) : (
        <div className='h-full space-y-1 overflow-auto'>
          {listSkills.map((skill) => (
            <SkillListItem
              key={skill.id}
              skill={skill}
              isSelected={skill.id === selectedSkillId}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onRename={handleRename}
              canEdit={permissions.canEdit}
              canDelete={listSkills.length > 1}
              isDeleting={deletingIds.has(skill.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
