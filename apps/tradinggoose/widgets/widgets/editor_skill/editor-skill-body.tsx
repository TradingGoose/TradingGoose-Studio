'use client'

import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { getSkillIdFromParams } from '@/widgets/widgets/_shared/skill/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'

type EditorSkillWidgetBodyProps = WidgetComponentProps

export function EditorSkillWidgetBody({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
}: EditorSkillWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.skillEditor.body
  const workspaceId = context?.workspaceId ?? null
  const { canEdit, isLoading: isPermissionsLoading } = useUserPermissionsContext()
  const canEditEntity = !isPermissionsLoading && canEdit
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const paramsSkillId = getSkillIdFromParams(params)
  const requestedSkillId = paramsSkillId
  const normalizedRequestedSkillId = requestedSkillId?.trim() ?? ''
  const hasRequestedSkill = normalizedRequestedSkillId.length > 0
  const {
    members: skillMembers,
    isLoading: isSkillListLoading,
    isRetrying: isSkillListRetrying,
    error: skillListError,
    retry: retrySkillList,
  } = useEntityList('skill', workspaceId)
  const requestedSkillMember = hasRequestedSkill
    ? skillMembers.find((member) => member.entityId === normalizedRequestedSkillId)
    : null
  const skillId = resolveEntityIdFromList({
    requestedEntityId: requestedSkillId,
    entityIds: skillMembers.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const selectedSkillMember = skillMembers.find((member) => member.entityId === skillId) ?? null
  const skillSession = useSavedEntityYjsSession(
    'skill',
    isPermissionsLoading ? null : skillId,
    isPermissionsLoading ? null : workspaceId,
    null,
    canEditEntity ? 'write' : 'read'
  )

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (skillListError && skillMembers.length === 0) {
    return (
      <WidgetStateMessage
        message={copy.failedToLoadSkills}
        variant='error'
        onRetry={retrySkillList}
        isRetrying={isSkillListRetrying}
      />
    )
  }

  if (
    hasRequestedSkill &&
    !isSkillListLoading &&
    !skillListError &&
    !requestedSkillMember &&
    !skillId
  ) {
    return <WidgetStateMessage message={copy.skillNotFound} />
  }

  if (skillSession.error) {
    return (
      <WidgetStateMessage
        message={copy.failedToLoadSkills}
        variant='error'
        onRetry={skillSession.retry}
        isRetrying={skillSession.isRetrying}
      />
    )
  }

  if (isSkillListLoading || skillSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!skillId) {
    return (
      <WidgetStateMessage
        message={resolvedPairColor !== 'gray' ? copy.noSharedSkillSelected : copy.selectSkillToEdit}
      />
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <SkillEditor
        doc={skillSession.doc}
        save={skillSession.save}
        skillId={skillId}
        entityName={selectedSkillMember?.entityName ?? ''}
        panelId={panelId}
        widgetKey={widget?.key}
        readOnly={!canEditEntity}
      />
    </div>
  )
}
