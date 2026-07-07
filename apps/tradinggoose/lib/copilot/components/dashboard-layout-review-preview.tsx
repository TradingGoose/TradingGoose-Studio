'use client'

import * as React from 'react'
import {
  DashboardLayoutPreviewCanvas,
  type DashboardLayoutPreviewCopy,
  type DashboardLayoutPreviewPanelDiffState,
} from '@/components/dashboard-layout-preview'
import type { LayoutNode } from '@/widgets/layout'
import type { DashboardLayoutReviewDiff } from '@/widgets/layout-document'

type PanelDiffState = DashboardLayoutPreviewPanelDiffState

const BADGE_CLASS =
  'rounded-sm border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground'

const DEFAULT_COPY: DashboardLayoutPreviewCopy = {
  headerAriaLabel: 'Dashboard panel actions',
  heightLabel: 'height',
  sizeLabel: 'Size',
  widthLabel: 'width',
}

type PanelActionHandlers = {
  persistGroupSizes?: (groupId: string, sizes: number[]) => void
  splitPanelVertical?: (panelId: string) => void
  splitPanelHorizontal?: (panelId: string) => void
  closePanel?: (panelId: string) => void
}

type DashboardLayoutPreviewProps = PanelActionHandlers & {
  layout: LayoutNode
  layoutName?: string
  sortOrder?: number
  isActive?: boolean
  copy?: Partial<DashboardLayoutPreviewCopy>
  panelDiffs?: ReadonlyMap<string, PanelDiffState>
  showPanelIds?: boolean
  showWidgetKeys?: boolean
}

function buildPanelDiffMaps(diff: DashboardLayoutReviewDiff) {
  const entries = (ids: string[], state: PanelDiffState) =>
    ids.map((panelId): [string, PanelDiffState] => [panelId, state])
  const changed = entries(diff.changedPanelIds, 'changed')

  return {
    after: new Map([...changed, ...entries(diff.addedPanelIds, 'added')]),
    before: new Map([...entries(diff.removedPanelIds, 'removed'), ...changed]),
  }
}

export function DashboardLayoutPreview({
  layout,
  layoutName,
  sortOrder,
  isActive,
  copy: copyOverrides,
  panelDiffs,
  showPanelIds = false,
  showWidgetKeys = false,
  ...handlers
}: DashboardLayoutPreviewProps) {
  const badges = [
    typeof sortOrder === 'number' ? `Sort ${sortOrder}` : null,
    typeof isActive === 'boolean' ? (isActive ? 'Active' : 'Inactive') : null,
  ].filter((badge): badge is string => badge !== null)

  return (
    <div className='flex h-full min-h-[240px] w-full min-w-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background/70'>
      {layoutName ? (
        <div className='flex flex-wrap items-center gap-2 border-border/60 border-b px-2 py-1.5'>
          <span className='truncate font-medium text-sm'>{layoutName}</span>
          {badges.map((badge) => (
            <span className={BADGE_CLASS} key={badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
      <div className='min-h-0 flex-1'>
        <DashboardLayoutPreviewCanvas
          copy={{ ...DEFAULT_COPY, ...copyOverrides }}
          layout={layout}
          panelDiffs={panelDiffs}
          showPanelIds={showPanelIds}
          showWidgetKeys={showWidgetKeys}
          {...handlers}
        />
      </div>
    </div>
  )
}

export function DashboardLayoutReviewPreview({
  title,
  layoutDiff,
}: {
  title: string
  layoutDiff: DashboardLayoutReviewDiff
}) {
  const panelDiffs = React.useMemo(() => buildPanelDiffMaps(layoutDiff), [layoutDiff])

  return (
    <div
      className='flex flex-col gap-3 rounded-md border border-border/60 bg-card/60 p-3'
      data-testid='dashboard-layout-review-preview'
    >
      <div className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
        {title}
      </div>
      <div className='grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2'>
        {(['before', 'after'] as const).map((side) => (
          <DashboardLayoutPreview
            isActive={layoutDiff[side].isActive}
            key={side}
            layout={layoutDiff[side].layout}
            layoutName={layoutDiff[side].name}
            panelDiffs={panelDiffs[side]}
            showPanelIds
            showWidgetKeys
            sortOrder={layoutDiff[side].sortOrder}
          />
        ))}
      </div>
    </div>
  )
}
