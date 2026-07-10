'use client'

import { useCallback, useRef } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { IndicatorCodePanel } from '@/widgets/widgets/editor_indicator/components/pine-indicator-code-panel'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { getIndicatorIdFromParams } from '@/widgets/widgets/editor_indicator/utils'

type EditorIndicatorWidgetBodyProps = WidgetComponentProps

export function EditorIndicatorWidgetBody({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
}: EditorIndicatorWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.indicatorEditor.body
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor

  const paramsIndicatorId = getIndicatorIdFromParams(params)
  const requestedIndicatorId = paramsIndicatorId

  const normalizedRequestedIndicatorId = requestedIndicatorId?.trim() ?? ''
  const hasRequestedIndicator = normalizedRequestedIndicatorId.length > 0
  const {
    members: indicatorMembers,
    isLoading: isIndicatorListLoading,
    error: indicatorListError,
  } = useEntityList('indicator', workspaceId)
  const requestedIndicatorMember = hasRequestedIndicator
    ? indicatorMembers.find((member) => member.entityId === normalizedRequestedIndicatorId)
    : null
  const indicatorId = resolveEntityIdFromList({
    requestedEntityId: requestedIndicatorId,
    entityIds: indicatorMembers.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const selectedIndicatorMember =
    indicatorMembers.find((member) => member.entityId === indicatorId) ?? null
  const indicatorSession = useSavedEntityYjsSession(
    'indicator',
    indicatorId,
    workspaceId,
    null,
    context?.canWrite === false ? 'read' : 'write'
  )

  const codeExportRef = useRef<() => void>(() => {})
  const codeSaveRef = useRef<() => void>(() => {})
  const codeVerifyRef = useRef<() => void>(() => {})

  const handleExport = useCallback(() => {
    codeExportRef.current()
  }, [])

  const handleSave = useCallback(() => {
    codeSaveRef.current()
  }, [])

  const handleVerify = useCallback(() => {
    codeVerifyRef.current()
  }, [])

  useIndicatorEditorActions({
    panelId,
    widget,
    onExport: handleExport,
    onSave: handleSave,
    onVerify: handleVerify,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (indicatorListError && indicatorMembers.length === 0) {
    return <WidgetStateMessage message={indicatorListError} />
  }

  if (
    hasRequestedIndicator &&
    !isIndicatorListLoading &&
    !indicatorListError &&
    !requestedIndicatorMember &&
    !indicatorId
  ) {
    return <WidgetStateMessage message={copy.indicatorNotFound} />
  }

  if (indicatorSession.error) {
    return <WidgetStateMessage message={indicatorSession.error} />
  }

  if (isIndicatorListLoading || indicatorSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!indicatorId) {
    return (
      <WidgetStateMessage
        message={
          resolvedPairColor !== 'gray' ? copy.noSharedIndicatorSelected : copy.selectIndicatorToEdit
        }
      />
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <IndicatorCodePanel
        indicatorId={indicatorId}
        indicatorName={selectedIndicatorMember?.entityName ?? ''}
        workspaceId={workspaceId}
        doc={indicatorSession.doc}
        save={indicatorSession.save}
        exportRef={codeExportRef}
        saveRef={codeSaveRef}
        verifyRef={codeVerifyRef}
      />
    </div>
  )
}
