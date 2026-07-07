'use client'

import { useRef } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { usePersistResolvedEntityId } from '@/widgets/utils/entity-selection'
import { useSkillEditorActions } from '@/widgets/utils/skill-editor-actions'
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
  onWidgetParamsPatch,
}: EditorSkillWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.skillEditor.body
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const exportRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})

  const paramsSkillId = getSkillIdFromParams(params)
  const requestedSkillId = paramsSkillId
  const normalizedRequestedSkillId = requestedSkillId?.trim() ?? ''
  const hasRequestedSkill = normalizedRequestedSkillId.length > 0
  const {
    members: skillMembers,
    isLoading: isSkillListLoading,
    error: skillListError,
  } = useEntityList('skill', workspaceId)
  const requestedSkillMember = hasRequestedSkill
    ? skillMembers.find((member) => member.entityId === normalizedRequestedSkillId)
    : null
  const skillId = resolveEntityIdFromList({
    requestedEntityId: requestedSkillId,
    entityIds: skillMembers.map((member) => member.entityId),
    useDefaultEntity: resolvedPairColor === 'gray',
  })
  const skillSession = useSavedEntityYjsSession('skill', skillId, workspaceId)

  usePersistResolvedEntityId({
    entityId: skillId,
    entityIdKey: 'skillId',
    onWidgetParamsPatch,
    params,
  })

  useSkillEditorActions({
    panelId,
    widget,
    onExport: () => exportRef.current(),
    onSave: () => saveRef.current(),
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (skillListError && skillMembers.length === 0) {
    return <WidgetStateMessage message={skillListError} />
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
    return <WidgetStateMessage message={skillSession.error} />
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
        exportRef={exportRef}
        saveRef={saveRef}
      />
    </div>
  )
}
