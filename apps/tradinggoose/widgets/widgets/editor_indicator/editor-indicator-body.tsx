'use client'

import { useCallback, useMemo, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useIndicators } from '@/hooks/queries/indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { useIndicatorSelectionPersistence } from '@/widgets/utils/indicator-selection'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { IndicatorCodePanel } from '@/widgets/widgets/editor_indicator/components/pine-indicator-code-panel'
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

  const paramsIndicatorId = useMemo(() => getIndicatorIdFromParams(params), [params])
  const fallbackIndicatorId = useMemo(() => {
    if (pairContext?.pineIndicatorId) return null
    return pairContext?.indicatorId ?? null
  }, [pairContext?.indicatorId, pairContext?.pineIndicatorId])
  const fallbackIndicator = useIndicatorsStore((state) =>
    fallbackIndicatorId ? state.getIndicator(fallbackIndicatorId, workspaceId ?? undefined) : undefined
  )
  const resolvedPairIndicatorId =
    pairContext?.pineIndicatorId ?? (fallbackIndicator ? fallbackIndicatorId : null)
  const indicatorId = isLinkedToColorPair ? resolvedPairIndicatorId : paramsIndicatorId

  const indicator = useIndicatorsStore((state) =>
    indicatorId ? state.getIndicator(indicatorId, workspaceId ?? undefined) : undefined
  )

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

  const codeSaveRef = useRef<() => void>(() => { })
  const codeVerifyRef = useRef<() => void>(() => { })

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

  if (isLoading && indicators.length === 0) {
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
