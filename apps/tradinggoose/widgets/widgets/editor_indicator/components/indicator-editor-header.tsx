'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Download, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { exportIndicatorsAsJson } from '@/lib/indicators/import-export'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { PairColor } from '@/widgets/pair-colors'
import {
  emitIndicatorEditorAction,
  useIndicatorEditorState,
} from '@/widgets/utils/indicator-editor-actions'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'

interface IndicatorEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  indicatorId?: string | null
  pairColor?: PairColor
  widgetKey?: string
}

export function IndicatorEditorSelector({
  workspaceId,
  panelId,
  indicatorId,
  pairColor = 'gray',
  widgetKey,
}: IndicatorEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (isLinkedToColorPair) {
      if (pairContext?.indicatorId === nextId) return
      setPairContext(resolvedPairColor, { indicatorId: nextId })
      return
    }
    if (!widgetKey) return

    emitIndicatorSelectionChange({
      indicatorId: nextId,
      panelId,
      widgetKey,
    })
  }

  return (
    <IndicatorDropdown
      workspaceId={workspaceId}
      value={resolvedIndicatorId ? [resolvedIndicatorId] : []}
      onChange={handleIndicatorChange}
      placeholder='Select indicator'
      selectionMode='single'
      triggerClassName='min-w-[220px]'
    />
  )
}

interface IndicatorEditorActionButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

const sanitizeFileNameSegment = (value: string) =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')

const downloadJsonFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

export function IndicatorEditorExportButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const [isDirty, setIsDirty] = useState(true)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)
  const indicator = useIndicatorsStore((state) =>
    workspaceId && resolvedIndicatorId
      ? state.getIndicator(resolvedIndicatorId, workspaceId)
      : undefined
  )

  useIndicatorEditorState({
    panelId,
    widget: widgetKey ? ({ key: widgetKey } as { key: string }) : null,
    onStateChange: (detail) => {
      setIsDirty(detail.isDirty)
    },
  })

  useEffect(() => {
    setIsDirty(true)
  }, [resolvedIndicatorId, workspaceId])

  const fileName = useMemo(() => {
    if (!indicator?.name) {
      return 'indicator.json'
    }

    const normalized = sanitizeFileNameSegment(indicator.name)
    return normalized.length > 0 ? `${normalized}.json` : 'indicator.json'
  }, [indicator?.name])

  const exportDisabled = !workspaceId || !resolvedIndicatorId || !indicator || isDirty
  const tooltipText =
    exportDisabled && indicator && isDirty ? 'Save indicator before exporting' : 'Export indicator'

  const handleExport = useCallback(() => {
    if (!indicator) return

    const json = exportIndicatorsAsJson({
      exportedFrom: 'indicatorEditor',
      indicators: [indicator],
    })

    downloadJsonFile(fileName, json)
  }, [fileName, indicator])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleExport}
            disabled={exportDisabled}
          >
            <Download className='h-4 w-4' />
            <span className='sr-only'>Export indicator</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{tooltipText}</TooltipContent>
    </Tooltip>
  )
}

export function IndicatorEditorSaveButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)
  const saveDisabled = !workspaceId || !resolvedIndicatorId

  const handleSave = () => {
    emitIndicatorEditorAction({
      action: 'save',
      panelId,
      widgetKey,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='default'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className='h-4 w-4' />
            <span className='sr-only'>Save indicator</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Save indicator</TooltipContent>
    </Tooltip>
  )
}

export function IndicatorEditorVerifyButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? indicatorId ?? null)
    : (indicatorId ?? null)
  const verifyDisabled = !workspaceId || !resolvedIndicatorId

  const handleVerify = () => {
    emitIndicatorEditorAction({
      action: 'verify',
      panelId,
      widgetKey,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleVerify}
            disabled={verifyDisabled}
          >
            <Check className='h-4 w-4' />
            <span className='sr-only'>Verify indicator</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Verify indicator</TooltipContent>
    </Tooltip>
  )
}
