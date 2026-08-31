'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useMessages } from 'next-intl'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import type { SkillDefinition } from '@/lib/skills/types'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { deleteSkill } from '@/hooks/queries/skills'
import { formatTemplate } from '@/i18n/utils'
import type { WidgetComponentProps } from '@/widgets/types'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { SkillListItem } from '@/widgets/widgets/_shared/skill/components/skill-list-item'
import { normalizeSkillName, resolveSkillId } from '@/widgets/widgets/_shared/skill/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'

export const SkillListMessage = WidgetStateMessage

export function SkillList({ context, params, onWidgetLinkedParamsPatch }: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.skillList
  const listItemCopy = copy.listItem
  const skillValidationCopy = useMessages().workspace.widgets.skillEditor.validation
  const workspaceId = context?.workspaceId ?? null
  const permissions = useUserPermissionsContext()
  const deleteLockRef = useRef(false)
  const deleteTargetRef = useRef<SkillDefinition | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SkillDefinition | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { members, isLoading, error } = useEntityList('skill', workspaceId)
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
  const selectionScopeRef = useRef({ workspaceId, requestedSkillId })
  selectionScopeRef.current = { workspaceId, requestedSkillId }
  const handleSelect = useCallback(
    (skillId: string | null) => {
      onWidgetLinkedParamsPatch?.({ skillId })
    },
    [onWidgetLinkedParamsPatch]
  )

  const handleDelete = useCallback(
    (skillId: string) => {
      if (!permissions.canEdit || deleteTargetRef.current) return
      const target = listSkills.find((skill) => skill.id === skillId)
      if (!target) return
      deleteTargetRef.current = target
      setDeleteTarget(target)
      setDeleteError(null)
    },
    [listSkills, permissions.canEdit]
  )

  const handleConfirmDelete = useCallback(async () => {
    const target = deleteTargetRef.current
    if (!target || deleteLockRef.current) return
    deleteLockRef.current = true
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteSkill({
        workspaceId: target.workspaceId,
        skillId: target.id,
      })
      const currentSelection = selectionScopeRef.current
      if (
        currentSelection.workspaceId === target.workspaceId &&
        currentSelection.requestedSkillId === target.id
      )
        handleSelect(null)
      deleteTargetRef.current = null
      setDeleteTarget(null)
    } catch (error) {
      console.error('Failed to delete skill', error)
      setDeleteError(listItemCopy.deleteFailed)
    } finally {
      deleteLockRef.current = false
      setIsDeleting(false)
    }
  }, [handleSelect, listItemCopy.deleteFailed])

  const closeDeleteDialog = () => {
    deleteTargetRef.current = null
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const handleRename = useCallback(
    async (skillId: string, name: string) => {
      if (!workspaceId || !permissions.canEdit) return

      const normalizedName = normalizeSkillName(name)
      if (!normalizedName) {
        throw new Error(skillValidationCopy.nameRequired)
      }

      if (normalizedName.length > SKILL_NAME_MAX_LENGTH) {
        throw new Error(
          formatTemplate(skillValidationCopy.nameTooLong, {
            max: SKILL_NAME_MAX_LENGTH,
          })
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
              deleteDisabled={isDeleting}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open, eventDetails) => {
          if (isDeleting) {
            eventDetails.cancel()
          } else if (!open) {
            closeDeleteDialog()
          }
        }}
      >
        <AlertDialogContent hideCloseButton={isDeleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{listItemCopy.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {listItemCopy.deleteDialogDescription}
              <span className='text-red-500 dark:text-red-500'>
                {' '}
                {listItemCopy.deleteDialogDescriptionHighlight}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role='alert' className='text-destructive text-sm'>
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              {listItemCopy.cancel}
            </AlertDialogCancel>
            <Button
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
              focusableWhenDisabled={isDeleting}
              aria-busy={isDeleting || undefined}
              variant='destructive'
              className='h-9 w-full rounded-sm'
            >
              {isDeleting ? listItemCopy.deleting : listItemCopy.delete}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
