'use client'

import { useCallback, useEffect, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useIndicators } from '@/hooks/queries/indicators'
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
  const workspaceId = context?.workspaceId ?? null
  const { data: indicators = [], isLoading, error } = useIndicators(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const paramsIndicatorId = getIndicatorIdFromParams(params)
  const requestedIndicatorId = isLinkedToColorPair
    ? (pairContext?.pineIndicatorId ?? paramsIndicatorId)
    : paramsIndicatorId

  const workspaceIndicators = workspaceId
    ? indicators.filter((indicator) => indicator.workspaceId === workspaceId)
    : []
  const normalizedRequestedIndicatorId = requestedIndicatorId?.trim() ?? ''
  const hasRequestedIndicator =
    normalizedRequestedIndicatorId.length > 0 &&
    workspaceIndicators.some((indicator) => indicator.id === normalizedRequestedIndicatorId)
  const indicatorId = hasRequestedIndicator
    ? normalizedRequestedIndicatorId
    : (workspaceIndicators[0]?.id ?? null)
  const indicator = indicatorId
    ? (workspaceIndicators.find((candidate) => candidate.id === indicatorId) ?? null)
    : null

  useEffect(() => {
    if (!indicatorId) {
      return
    }

    if (isLinkedToColorPair) {
      if (pairContext?.pineIndicatorId === indicatorId) {
        return
      }

      setPairContext(resolvedPairColor, { pineIndicatorId: indicatorId })
      return
    }

    if (!onWidgetParamsChange || paramsIndicatorId === indicatorId) {
      return
    }

    onWidgetParamsChange({
      ...(params ?? {}),
      pineIndicatorId: indicatorId,
    })
  }, [
    indicatorId,
    isLinkedToColorPair,
    onWidgetParamsChange,
    pairContext?.pineIndicatorId,
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
      if (pairContext?.pineIndicatorId === nextId) return
      setPairContext(resolvedPairColor, { pineIndicatorId: nextId })
    },
  })

  const codeSaveRef = useRef<() => void>(() => {})
  const codeVerifyRef = useRef<() => void>(() => {})

  const handleSave = useCallback(() => {
    codeSaveRef.current()
  }, [])

  const handleVerify = useCallback(() => {
    codeVerifyRef.current()
  }, [])

  useIndicatorEditorActions({
    panelId,
    widget,
    onSave: handleSave,
    onVerify: handleVerify,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to edit indicators.' />
  }

  if (error) {
    return (
      <WidgetStateMessage
        message={error instanceof Error ? error.message : 'Failed to load indicators.'}
      />
    )
  }

  if (isLoading && workspaceIndicators.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!indicatorId) {
    return <WidgetStateMessage message='Select an indicator to edit.' />
  }

  if (!indicator) {
    return <WidgetStateMessage message='Indicator not found.' />
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <IndicatorCodePanel
        indicator={indicator}
        indicatorId={indicatorId}
        workspaceId={workspaceId}
        saveRef={codeSaveRef}
        verifyRef={codeVerifyRef}
      />
    </div>
  )
}
