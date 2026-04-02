'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useDeleteSkill, useSkills, useUpdateSkill } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useSkillsStore } from '@/stores/skills/store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitSkillSelectionChange,
  useSkillSelectionPersistence,
} from '@/widgets/utils/skill-selection'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { SkillListItem } from '@/widgets/widgets/_shared/skill/components/skill-list-item'
import {
  normalizeSkillName,
  resolveSkillId,
  SKILL_EDITOR_WIDGET_KEY,
  SKILL_LIST_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'

export const SkillListMessage = WidgetStateMessage

export function SkillList({
  context,
  params,
  onWidgetParamsChange,
  panelId,
  pairColor = 'gray',
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const { data: querySkills = [], isLoading, error } = useSkills(workspaceId ?? '')
  const deleteMutation = useDeleteSkill()
  const updateMutation = useUpdateSkill()
  const storedSkills = useSkillsStore((state) =>
    workspaceId ? state.getAllSkills(workspaceId) : []
  )
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

  const listSkills = querySkills.length > 0 ? querySkills : storedSkills

  const selectedSkillId = useMemo(
    () => resolveSkillId({ params, pairContext: isLinkedToColorPair ? pairContext : null }),
    [isLinkedToColorPair, pairContext, params]
  )

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

  useEffect(() => {
    if (!selectedSkillId || listSkills.some((skill) => skill.id === selectedSkillId)) {
      return
    }

    handleSelect(null)
  }, [handleSelect, listSkills, selectedSkillId])

  const handleDelete = useCallback(
    async (skillId: string) => {
      if (!workspaceId || !permissions.canEdit) return
      if (!skillId) return

      setDeletingIds((prev) => new Set(prev).add(skillId))

      try {
        await deleteMutation.mutateAsync({ workspaceId, skillId })
        if (selectedSkillId === skillId) {
          handleSelect(null)
        }
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
        throw new Error('Skill name must contain letters or numbers')
      }

      await updateMutation.mutateAsync({
        workspaceId,
        skillId,
        updates: {
          name: normalizedName,
        },
      })
    },
    [permissions.canEdit, updateMutation, workspaceId]
  )

  if (isLoading && listSkills.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error && listSkills.length === 0) {
    return (
      <SkillListMessage
        message={error instanceof Error ? error.message : 'Failed to load skills.'}
      />
    )
  }

  return (
    <div className='h-full w-full overflow-hidden p-2'>
      {listSkills.length === 0 ? (
        <SkillListMessage message='No skills yet.' />
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
