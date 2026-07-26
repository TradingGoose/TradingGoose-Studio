'use client'

import * as React from 'react'
import { Card } from '@/components/ui/card'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { formatTemplate, type LocaleCode } from '@/i18n/utils'
import type { LayoutNode } from '@/widgets/layout'
import { WidgetActionMenu } from '@/widgets/widgets/components/widget-action-menu'

const PANEL_MIN_SIZE = 10
const MIN_SPLIT_SIZE = PANEL_MIN_SIZE * 2

export type DashboardLayoutPreviewCopy = {
  headerAriaLabel: string
  sizeLabel: string
  widthLabel: string
  heightLabel: string
}

type GroupNode = Extract<LayoutNode, { type: 'group' }>
type PanelNode = Extract<LayoutNode, { type: 'panel' }>

type PanelActionHandlers = {
  persistGroupSizes?: (groupId: string, sizes: number[]) => void
  splitPanelVertical?: (panelId: string) => void
  splitPanelHorizontal?: (panelId: string) => void
  closePanel?: (panelId: string) => void
}

type PreviewContext = PanelActionHandlers & {
  copy: DashboardLayoutPreviewCopy
  locale?: LocaleCode
  showDimensions: boolean
  showWidgetKeys: boolean
}

export type DashboardLayoutPreviewCanvasProps = PanelActionHandlers & {
  layout: LayoutNode
  copy: DashboardLayoutPreviewCopy
  locale?: LocaleCode
  showDimensions?: boolean
  showWidgetKeys?: boolean
}

const formatPanelDimension = (value: number) => (value > 0 ? `${value}px` : '--')
const clampPx = (value: number) => Math.max(0, Math.round(value))

function childMetrics(node: GroupNode, index: number, width: number, height: number) {
  const size = node.sizes[index] ?? 100 / Math.max(node.children.length, 1)
  return {
    size,
    width: node.direction === 'horizontal' ? (width * size) / 100 : width,
    height: node.direction === 'vertical' ? (height * size) / 100 : height,
  }
}

function DashboardLayoutPanelSurface({
  node,
  ctx,
  width,
  height,
}: {
  node: PanelNode
  ctx: PreviewContext
  width: number
  height: number
}) {
  const headerScrollRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = React.useState({ width: 0, height: 0 })
  const { copy, splitPanelVertical, splitPanelHorizontal, closePanel } = ctx
  const onSplitVertical =
    splitPanelVertical && height >= MIN_SPLIT_SIZE ? () => splitPanelVertical(node.id) : undefined
  const onSplitHorizontal =
    splitPanelHorizontal && width >= MIN_SPLIT_SIZE
      ? () => splitPanelHorizontal(node.id)
      : undefined
  const onClose = closePanel ? () => closePanel(node.id) : undefined
  const hasActions = Boolean(onSplitVertical || onSplitHorizontal || onClose)

  const handleHorizontalWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!headerScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    headerScrollRef.current.scrollLeft += event.deltaY
  }, [])

  React.useEffect(() => {
    const element = bodyRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const update = () => {
      const rect = element.getBoundingClientRect()
      setPanelSize({ width: clampPx(rect.width), height: clampPx(rect.height) })
    }
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div className='box-border flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-1 basis-0 p-1'>
      <Card className='flex h-full max-h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background'>
        <header className='border-border/80 border-b bg-muted/40 text-accent-foreground'>
          <div
            ref={headerScrollRef}
            onWheel={handleHorizontalWheel}
            className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            aria-label={copy.headerAriaLabel}
          >
            <div className='flex h-8 w-full flex-nowrap items-center justify-end py-0.5 pr-1 text-accent-foreground text-sm'>
              {ctx.showWidgetKeys ? (
                <span className='min-w-0 flex-1 truncate px-2 text-muted-foreground text-xs'>
                  {node.widget?.key ?? 'empty'}
                </span>
              ) : null}
              {hasActions ? (
                <WidgetActionMenu
                  onClose={onClose}
                  onSplitHorizontal={onSplitHorizontal}
                  onSplitVertical={onSplitVertical}
                />
              ) : null}
            </div>
          </div>
        </header>
        <div
          ref={bodyRef}
          className='flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden px-4 py-6 text-center'
        >
          {ctx.showDimensions ? (
            <>
              <div className='space-y-1'>
                <p className='font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.24em]'>
                  {copy.sizeLabel}
                </p>
                <p className='font-medium text-2xl text-foreground tabular-nums'>
                  {formatPanelDimension(panelSize.width)} × {formatPanelDimension(panelSize.height)}
                </p>
              </div>
              <p className='text-muted-foreground text-xs tabular-nums'>
                {formatTemplate(
                  '{width}% {widthLabel} · {height}% {heightLabel}',
                  {
                    height: Math.round(height),
                    heightLabel: copy.heightLabel,
                    width: Math.round(width),
                    widthLabel: copy.widthLabel,
                  },
                  ctx.locale
                )}
              </p>
            </>
          ) : (
            <div className='max-w-full truncate rounded-sm border border-border/60 bg-muted/40 px-2 py-1 font-medium text-muted-foreground text-xs'>
              {node.widget?.key ?? 'empty'}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

const DashboardLayoutPreviewNode = React.memo(function DashboardLayoutPreviewNode({
  node,
  ctx,
  width = 100,
  height = 100,
}: {
  node: LayoutNode
  ctx: PreviewContext
  width?: number
  height?: number
}) {
  if (node.type === 'panel') {
    return <DashboardLayoutPanelSurface ctx={ctx} height={height} node={node} width={width} />
  }

  if (!ctx.persistGroupSizes) {
    const staticCtx: PreviewContext = {
      copy: ctx.copy,
      locale: ctx.locale,
      showDimensions: ctx.showDimensions,
      showWidgetKeys: ctx.showWidgetKeys,
    }

    return (
      <div
        className={`flex h-full min-h-0 w-full ${node.direction === 'horizontal' ? 'flex-row' : 'flex-col'}`}
      >
        {node.children.map((child, index) => {
          const metrics = childMetrics(node, index, width, height)
          return (
            <div
              key={child.id}
              className='min-h-0 min-w-0'
              style={{
                flexBasis: `${metrics.size}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
            >
              <DashboardLayoutPreviewNode
                ctx={staticCtx}
                height={metrics.height}
                node={child}
                width={metrics.width}
              />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      key={node.id}
      direction={node.direction}
      onLayout={(sizes) => ctx.persistGroupSizes?.(node.id, sizes)}
      className='h-full w-full'
    >
      {node.children.map((child, index) => {
        const metrics = childMetrics(node, index, width, height)
        return (
          <React.Fragment key={`${node.id}-${child.id}`}>
            <ResizablePanel
              id={child.id}
              order={index + 1}
              defaultSize={metrics.size}
              minSize={PANEL_MIN_SIZE}
              collapsible
            >
              <DashboardLayoutPreviewNode
                ctx={ctx}
                height={metrics.height}
                node={child}
                width={metrics.width}
              />
            </ResizablePanel>
            {index < node.children.length - 1 ? <ResizableHandle withHandle /> : null}
          </React.Fragment>
        )
      })}
    </ResizablePanelGroup>
  )
})

export function DashboardLayoutPreviewCanvas({
  layout,
  copy,
  locale,
  showDimensions = true,
  showWidgetKeys = false,
  ...handlers
}: DashboardLayoutPreviewCanvasProps) {
  const ctx: PreviewContext = {
    copy,
    locale,
    showDimensions,
    showWidgetKeys,
    ...handlers,
  }

  return <DashboardLayoutPreviewNode ctx={ctx} node={layout} />
}
