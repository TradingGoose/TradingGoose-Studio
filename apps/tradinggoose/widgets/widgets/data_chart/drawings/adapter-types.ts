import type { MutableRefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/snapshot'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import type { ILineToolsPlugin, LineToolExport } from '@/widgets/widgets/data_chart/plugins/core'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

export type OwnerId = string
export type SeriesAttachmentKey = string

export type ToolCreateCapability = 'unknown' | 'supported' | 'unsupported'
export type OwnerVisibilityMode = 'hide' | 'show'

export type OwnerToolCapability = {
  supportsCreate: ToolCreateCapability
  canEdit: boolean | null
}

export type OwnerBinding = {
  seriesAttachmentKey: SeriesAttachmentKey
  pane: 'price' | 'indicator'
  indicatorId?: string
}

export type ResolvedOwnerTarget = {
  seriesAttachmentKey: SeriesAttachmentKey
  series: ISeriesApi<any>
  pane: 'price' | 'indicator'
  indicatorId?: string
}

export type PluginEntry = {
  plugin: ILineToolsPlugin
  series: ISeriesApi<any>
  chartElement: HTMLElement
  owners: Set<OwnerId>
  pointerUpHandler: (event: PointerEvent) => void
  windowMouseUpHandler: (event: MouseEvent) => void
  afterEditHandler: (event: unknown) => void
  doubleClickHandler: (event: unknown) => void
}

export type PluginContext = {
  binding: OwnerBinding
  pluginEntry: PluginEntry
}

export type DetachOptions = {
  preserveCapabilities?: boolean
  preservePendingSnapshot?: boolean
}

export type InlineTextEditorEntry = {
  ownerId: OwnerId
  seriesAttachmentKey: SeriesAttachmentKey
  toolId: string
  element: HTMLTextAreaElement
  finalize: (commit: boolean) => void
}

export type OpenInlineTextEditorParams = {
  ownerId: OwnerId
  seriesAttachmentKey: SeriesAttachmentKey
  plugin: ILineToolsPlugin
  series: ISeriesApi<any>
  tool: LineToolExport<any>
}

export type InlineTextEditorControllerParams = {
  chartRef: MutableRefObject<IChartApi | null>
  activeInlineTextEditorRef: MutableRefObject<InlineTextEditorEntry | null>
  parseLineToolExports: (serialized: string) => Array<LineToolExport<any>>
  reconcileSelection: (ownerId: OwnerId) => void
  bumpVersion: () => void
}

export type OwnerStateRefs = {
  ownerToolIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerToolIdsByTypeRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, string>>>
  ownerSelectedIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerCapabilitiesRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, OwnerToolCapability>>>
  pendingOwnerSnapshotRef: MutableRefObject<Map<OwnerId, ManualOwnerSnapshot>>
}

export type ClearOwnerStateOptions = {
  clearCapabilities?: boolean
  clearPending?: boolean
}

export type UseManualLineToolsAdapterParams = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  chartReady: number
  syncVersion?: number
  panelId?: string
  drawTools: DrawToolsRef[]
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  indicatorRuntimeVersion: number
  onActiveDrawToolsIdChange?: (drawToolsId: string) => void
}
