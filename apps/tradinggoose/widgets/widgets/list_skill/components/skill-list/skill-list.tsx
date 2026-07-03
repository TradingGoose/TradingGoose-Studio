'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import { saveSavedEntityField, useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useDeleteSkill } from '@/hooks/queries/skills'
import { formatTemplate } from '@/i18n/utils'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { SkillDefinition } from '@/lib/skills/types'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  resolveEntityIdFromList,
  usePersistResolvedEntityId,
} from '@/widgets/utils/entity-selection'
import {
  emitSkillSelectionChange,
  useSkillSelectionPersistence,
} from '@/widgets/utils/skill-selection'
import { SkillListItem } from '@/widgets/widgets/_shared/skill/components/skill-list-item'
import {
  normalizeSkillName,
  resolveSkillId,
  SKILL_EDITOR_WIDGET_KEY,
  SKILL_LIST_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

export const SkillListMessage = WidgetStateMessage

export function SkillList({
  context,
  params,
  onWidgetParamsChange,
  panelId,
  pairColor = 'gray',
}: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.skillList
  const skillValidationCopy = useMessages().workspace.widgets.skillEditor.validation
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { members, isLoading, error } = useEntityList('skill', workspaceId)
  const deleteMutation = useDeleteSkill()
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  useSkillSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: SKILL_LIST_WIDGET_KEY,
    onSkillSelect: (skillId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.skillId === skillId) return
      setPairContext(resolvedPairColor, { skillId })
    },
  })

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
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const selectedSkillId = resolveEntityIdFromList({
    requestedEntityId: requestedSkillId,
    entityIds: listSkills.map((skill) => skill.id),
    useDefaultEntity: !isLinkedToColorPair,
  })

  usePersistResolvedEntityId({
    entityId: selectedSkillId,
    entityIdKey: 'skillId',
    onWidgetParamsChange,
    pairColor: resolvedPairColor,
    params,
  })

  const handleSelect = useCallback(
    (skillId: string | null) => {
      if (isLinkedToColorPair) {
        if (pairContext?.skillId !== skillId) {
          setPairContext(resolvedPairColor, { skillId })
        }
        return
      }

      const currentParams =
        params && typeof params === 'object' ? (params as Record<string, unknown>) : {}

      onWidgetParamsChange?.({
        ...currentParams,
        skillId,
      })

      emitSkillSelectionChange({
        skillId,
        panelId,
        widgetKey: SKILL_EDITOR_WIDGET_KEY,
      })
    },
    [
      isLinkedToColorPair,
      onWidgetParamsChange,
      pairContext?.skillId,
      panelId,
      params,
      resolvedPairColor,
      setPairContext,
    ]
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

      await saveSavedEntityField('skill', skillId, workspaceId, 'name', normalizedName)
    },
    [permissions.canEdit, workspaceId]
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
              isDeleting={deletingIds.has(skill.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
