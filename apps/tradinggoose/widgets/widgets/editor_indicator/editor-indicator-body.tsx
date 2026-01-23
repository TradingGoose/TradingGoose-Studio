'use client'

import { useCallback, useMemo, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useCustomIndicators } from '@/hooks/queries/custom-indicators'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { useIndicatorSelectionPersistence } from '@/widgets/utils/indicator-selection'
import { IndicatorCodePanel } from '@/widgets/widgets/editor_indicator/components/indicator-code-panel'
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
  const { data: indicators = [], isLoading, error } = useCustomIndicators(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const paramsIndicatorId = useMemo(() => getIndicatorIdFromParams(params), [params])
  const indicatorId = isLinkedToColorPair ? pairContext?.indicatorId ?? null : paramsIndicatorId

  const indicator = useCustomIndicatorsStore((state) =>
    indicatorId ? state.getIndicator(indicatorId, workspaceId ?? undefined) : undefined
  )

  useIndicatorSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params,
    pairColor: resolvedPairColor,
    onIndicatorSelect: (nextId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.indicatorId === nextId) return
      setPairContext(resolvedPairColor, { indicatorId: nextId })
    },
  })
  const codeSaveRef = useRef<() => void>(() => {})

  const handleSave = useCallback(() => {
    codeSaveRef.current()
  }, [])

  useIndicatorEditorActions({
    panelId,
    widget,
    onSave: handleSave,
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
      />
    </div>
  )
}
