'use client'

import { useCallback, useMemo, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useNewIndicators } from '@/hooks/queries/new-indicators'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useNewIndicatorsStore } from '@/stores/new-indicators/store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { useNewIndicatorSelectionPersistence } from '@/widgets/utils/new-indicator-selection'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { PineIndicatorCodePanel } from '@/widgets/widgets/new_editor_indicator/components/pine-indicator-code-panel'
import { getPineIndicatorIdFromParams } from '@/widgets/widgets/new_editor_indicator/utils'

type NewEditorIndicatorWidgetBodyProps = WidgetComponentProps

export function NewEditorIndicatorWidgetBody({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: NewEditorIndicatorWidgetBodyProps) {
  const workspaceId = context?.workspaceId ?? null
  const { data: indicators = [], isLoading, error } = useNewIndicators(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const paramsIndicatorId = useMemo(() => getPineIndicatorIdFromParams(params), [params])
  const fallbackIndicatorId = useMemo(() => {
    if (pairContext?.pineIndicatorId) return null
    return pairContext?.indicatorId ?? null
  }, [pairContext?.indicatorId, pairContext?.pineIndicatorId])
  const fallbackIndicator = useNewIndicatorsStore((state) =>
    fallbackIndicatorId ? state.getIndicator(fallbackIndicatorId, workspaceId ?? undefined) : undefined
  )
  const resolvedPairIndicatorId =
    pairContext?.pineIndicatorId ?? (fallbackIndicator ? fallbackIndicatorId : null)
  const indicatorId = isLinkedToColorPair ? resolvedPairIndicatorId : paramsIndicatorId

  const indicator = useNewIndicatorsStore((state) =>
    indicatorId ? state.getIndicator(indicatorId, workspaceId ?? undefined) : undefined
  )

  useNewIndicatorSelectionPersistence({
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
      <PineIndicatorCodePanel
        indicator={indicator}
        indicatorId={indicatorId}
        workspaceId={workspaceId}
        saveRef={codeSaveRef}
        verifyRef={codeVerifyRef}
      />
    </div>
  )
}
