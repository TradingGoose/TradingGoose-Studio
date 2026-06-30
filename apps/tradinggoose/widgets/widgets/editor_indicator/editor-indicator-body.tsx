'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { useIndicatorSelectionPersistence } from '@/widgets/utils/indicator-selection'
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
  onWidgetParamsChange,
}: EditorIndicatorWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.indicatorEditor.body
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const paramsIndicatorId = getIndicatorIdFromParams(params)
  const requestedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
    : paramsIndicatorId

  const normalizedRequestedIndicatorId = requestedIndicatorId?.trim() ?? ''
  const hasRequestedIndicator = normalizedRequestedIndicatorId.length > 0
  const {
    members: indicatorMembers,
    isLoading: isIndicatorListLoading,
    error: indicatorListError,
  } = useEntityList('indicator', workspaceId)
  const indicatorId = hasRequestedIndicator
    ? normalizedRequestedIndicatorId
    : isLinkedToColorPair
      ? null
      : (indicatorMembers[0]?.entityId ?? null)
  const indicatorSession = useSavedEntityYjsSession('indicator', indicatorId, workspaceId)

  useEffect(() => {
    if (!indicatorId) {
      return
    }

    if (isLinkedToColorPair) {
      if (pairContext?.indicatorId === indicatorId) {
        return
      }

      setPairContext(resolvedPairColor, { indicatorId })
      return
    }

    if (!onWidgetParamsChange || paramsIndicatorId === indicatorId) {
      return
    }

    onWidgetParamsChange({
      ...(params ?? {}),
      indicatorId,
    })
  }, [
    indicatorId,
    isLinkedToColorPair,
    onWidgetParamsChange,
    pairContext?.indicatorId,
    params,
    paramsIndicatorId,
    resolvedPairColor,
    setPairContext,
  ])

  useIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    onIndicatorSelect: (nextId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.indicatorId === nextId) return
      setPairContext(resolvedPairColor, { indicatorId: nextId })
    },
  })

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

  if (!hasRequestedIndicator && indicatorListError) {
    return <WidgetStateMessage message={indicatorListError} />
  }

  if (indicatorSession.error) {
    return <WidgetStateMessage message={indicatorSession.error} />
  }

  if ((!hasRequestedIndicator && isIndicatorListLoading) || indicatorSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!indicatorId) {
    return (
      <WidgetStateMessage
        message={isLinkedToColorPair ? copy.noSharedIndicatorSelected : copy.selectIndicatorToEdit}
      />
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <IndicatorCodePanel
        indicatorId={indicatorId}
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
