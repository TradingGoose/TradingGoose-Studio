'use client'

import type { RefObject } from 'react'
import type { IPaneApi } from 'lightweight-charts'
import type { InputMetaMap } from '@/lib/indicators/types'
import type { ListingOption } from '@/lib/listing/identity'
import { ChartLegend } from '@/widgets/widgets/data_chart/components/chart-legend'
import { DrawControl } from '@/widgets/widgets/data_chart/components/draw-control'
import { IndicatorControl } from '@/widgets/widgets/data_chart/components/indicator-control'
import { PaneControl } from '@/widgets/widgets/data_chart/components/pane-control'
import type { LegendData } from '@/widgets/widgets/data_chart/hooks/use-chart-legend'
import type { IndicatorPlotValue } from '@/widgets/widgets/data_chart/hooks/use-indicator-legend'

export type PaneIndicatorControlItem = {
  id: string
  name: string
  inputMeta?: InputMetaMap | null
  inputs?: Record<string, unknown>
  values: IndicatorPlotValue[]
  isHidden: boolean
  errorMessage?: string
}

type ChartPaneOverlaysProps = {
  paneSnapshot: IPaneApi<any>[]
  paneLayout: Array<{ top: number; height: number }>
  mainPaneIndex: number
  legendOffset: number
  legendData: LegendData | null
  listingLabel: string | null
  resolvedListing: ListingOption | null
  intervalLabel: string
  isResolving: boolean
  legendContainerRef: RefObject<HTMLDivElement | null>
  leftOverlayInsetPx: number
  indicatorControlsByPane: Map<number, PaneIndicatorControlItem[]>
  hasIndicatorRuntime: boolean
  resolveSelectedOwnerForPane: (paneIndex: number) => string | null
  onToggleHidden: (indicatorId: string) => void
  onRemoveIndicator: (indicatorId: string) => void
  onOpenSettings: (indicatorId: string) => void
  onHideSelectedDrawings: (ownerId?: string | null) => void
  onRemoveSelectedDrawings: (ownerId?: string | null) => void
  onMovePaneUp: (pane: IPaneApi<any>) => void
  onMovePaneDown: (pane: IPaneApi<any>) => void
}

export const ChartPaneOverlays = ({
  paneSnapshot,
  paneLayout,
  mainPaneIndex,
  legendOffset,
  legendData,
  listingLabel,
  resolvedListing,
  intervalLabel,
  isResolving,
  legendContainerRef,
  leftOverlayInsetPx,
  indicatorControlsByPane,
  hasIndicatorRuntime,
  resolveSelectedOwnerForPane,
  onToggleHidden,
  onRemoveIndicator,
  onOpenSettings,
  onHideSelectedDrawings,
  onRemoveSelectedDrawings,
  onMovePaneUp,
  onMovePaneDown,
}: ChartPaneOverlaysProps) => {
  return (
    <div className='pointer-events-none absolute inset-0 z-10'>
      {paneSnapshot.map((pane) => {
        const paneIndex = pane.paneIndex()
        const layout = paneLayout[paneIndex]
        if (!layout) return null
        const indicatorItems = indicatorControlsByPane.get(paneIndex) ?? []
        const isMainPane = paneIndex === mainPaneIndex
        const topOffset = isMainPane ? legendOffset - 2 : 2
        const selectedOwnerIdInPane = resolveSelectedOwnerForPane(paneIndex)
        const hasSelectedManualInPane = selectedOwnerIdInPane !== null
        const showRightControls = hasIndicatorRuntime || hasSelectedManualInPane

        return (
          <div
            key={`pane-overlay-${paneIndex}`}
            className='absolute right-0 left-0'
            style={{ top: `${layout.top}px`, height: `${layout.height}px` }}
          >
            <div className='relative h-full w-full'>
              {isMainPane && (
                <ChartLegend
                  legend={legendData}
                  listingLabel={listingLabel}
                  listing={resolvedListing}
                  intervalLabel={intervalLabel}
                  isResolving={isResolving}
                  containerRef={legendContainerRef}
                  leftInsetPx={leftOverlayInsetPx}
                />
              )}
              {hasIndicatorRuntime && indicatorItems.length > 0 && (
                <div
                  className='pointer-events-none absolute mr-24 pr-20'
                  style={{ top: `${topOffset}px`, left: `${leftOverlayInsetPx}px` }}
                >
                  <div className='inline-flex flex-col items-start gap-1'>
                    {indicatorItems.map((item) => (
                      <div key={item.id} className='pointer-events-none'>
                        <IndicatorControl
                          indicatorId={item.id}
                          name={item.name}
                          inputMeta={item.inputMeta}
                          indicatorInputs={item.inputs}
                          plotValues={item.values}
                          isHidden={item.isHidden}
                          errorMessage={item.errorMessage}
                          onToggleHidden={onToggleHidden}
                          onRemove={onRemoveIndicator}
                          onOpenSettings={onOpenSettings}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showRightControls && (
                <div className='pointer-events-auto absolute top-[3px] right-[4px] pr-14'>
                  <div className='inline-flex items-start gap-1'>
                    {hasSelectedManualInPane && (
                      <DrawControl
                        onHideSelected={() => onHideSelectedDrawings(selectedOwnerIdInPane)}
                        onRemoveSelected={() => onRemoveSelectedDrawings(selectedOwnerIdInPane)}
                        disabled={!selectedOwnerIdInPane}
                      />
                    )}
                    {hasIndicatorRuntime && (
                      <PaneControl
                        paneIndex={paneIndex}
                        paneCount={paneSnapshot.length}
                        onMoveUp={() => onMovePaneUp(pane)}
                        onMoveDown={() => onMovePaneDown(pane)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
