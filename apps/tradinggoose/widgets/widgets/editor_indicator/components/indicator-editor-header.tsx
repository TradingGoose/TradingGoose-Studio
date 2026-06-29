'use client'

import { Check, Download, Save } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useMessages } from 'next-intl'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitIndicatorEditorAction } from '@/widgets/utils/indicator-editor-actions'
import { emitIndicatorSelectionChange } from '@/widgets/utils/indicator-selection'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
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
      placeholder={copy.selectIndicator}
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

export function IndicatorEditorExportButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
    : (indicatorId ?? null)
  const exportDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <EntityEditorHeaderButton
      tooltip={copy.exportIndicator}
      label={copy.exportIndicator}
      icon={Download}
      disabled={exportDisabled}
      onClick={() => emitIndicatorEditorAction({ action: 'export', panelId, widgetKey })}
    />
  )
}

export function IndicatorEditorSaveButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
    : (indicatorId ?? null)
  const saveDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <EntityEditorHeaderButton
      tooltip={copy.saveIndicator}
      label={copy.saveIndicator}
      icon={Save}
      disabled={saveDisabled}
      variant='default'
      onClick={() => emitIndicatorEditorAction({ action: 'save', panelId, widgetKey })}
    />
  )
}

export function IndicatorEditorVerifyButton({
  workspaceId,
  indicatorId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: IndicatorEditorActionButtonProps) {
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedIndicatorId = isLinkedToColorPair
    ? (pairContext?.indicatorId ?? null)
    : (indicatorId ?? null)
  const verifyDisabled = !workspaceId || !resolvedIndicatorId

  return (
    <EntityEditorHeaderButton
      tooltip={copy.verifyIndicator}
      label={copy.verifyIndicator}
      icon={Check}
      disabled={verifyDisabled}
      variant='secondary'
      onClick={() => emitIndicatorEditorAction({ action: 'verify', panelId, widgetKey })}
    />
  )
}
