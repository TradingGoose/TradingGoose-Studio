'use client'

import { Fragment, memo, type ReactNode, useCallback, useRef } from 'react'
import { Card } from '@/components/ui/card'
import type { WidgetInstance } from '@/widgets/layout'
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import { getWidgetDefinition } from '@/widgets/registry'
import type { WidgetComponentProps, WidgetHeaderSlots, WidgetRuntimeContext } from '@/widgets/types'
import { PairColorDropdown } from '@/widgets/widgets/components/pair-color-dropdown'
import { WidgetActionMenu } from '@/widgets/widgets/components/widget-action-menu'
import { WidgetSelector } from '@/widgets/widgets/components/widget-selector'

type HeaderSlotContent = ReactNode | ReactNode[]
type WidgetSurfaceHeader = Partial<WidgetHeaderSlots>

interface WidgetSurfaceProps {
  widget: WidgetInstance
  header?: WidgetSurfaceHeader
  context?: WidgetRuntimeContext
  onPairColorChange?: (color: PairColor) => void
  onWidgetChange?: (widgetKey: string) => void
  panelId?: string
  onPanelSplit?: () => void
  onPanelSplitHorizontal?: () => void
  onPanelClose?: () => void
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
}

function WidgetSurfaceComponent({
  widget,
  header,
  context,
  onPairColorChange,
  onWidgetChange,
  panelId,
  onPanelSplit,
  onPanelSplitHorizontal,
  onPanelClose,
  onWidgetParamsChange,
}: WidgetSurfaceProps) {
  const widgetKey = widget?.key ?? 'empty'
  const emptyDefinition = getWidgetDefinition('empty')
  const definition = getWidgetDefinition(widgetKey) ?? emptyDefinition
  const pairColor = isPairColor(widget?.pairColor) ? widget?.pairColor : 'gray'
  const WidgetComponent = definition?.component ?? emptyDefinition?.component
  type RuntimeWidgetComponent = (
    props: WidgetComponentProps & { onWidgetChange?: (widgetKey: string) => void }
  ) => ReactNode
  const RenderWidgetComponent = WidgetComponent as RuntimeWidgetComponent
  const registryHeader =
    definition?.renderHeader?.({ widget, context, panelId }) ??
    emptyDefinition?.renderHeader?.({ widget, context, panelId })
  const headerScrollRef = useRef<HTMLDivElement>(null)

  const handleHorizontalWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!headerScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }
    event.preventDefault()
    headerScrollRef.current.scrollLeft += event.deltaY
  }, [])

  const handleWidgetSelect = useCallback(
    (key: string) => {
      if (!onWidgetChange) return
      onWidgetChange(key)
    },
    [onWidgetChange]
  )

  const handlePairColorSelect = useCallback(
    (color: PairColor) => {
      if (!onPairColorChange) return
      onPairColorChange(color)
    },
    [onPairColorChange]
  )

  const handlePanelSplit = useCallback(() => {
    if (!onPanelSplit) return
    onPanelSplit()
  }, [onPanelSplit])

  const handlePanelSplitHorizontal = useCallback(() => {
    if (!onPanelSplitHorizontal) return
    onPanelSplitHorizontal()
  }, [onPanelSplitHorizontal])

  const handlePanelClose = useCallback(() => {
    if (!onPanelClose) return
    onPanelClose()
  }, [onPanelClose])

  return (
    <div className='box-border flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-1 basis-0 p-1'>
      <Card className='flex h-full max-h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background'>
        <header className='border-border/80 border-b bg-muted/40 text-accent-foreground'>
          <div
            ref={headerScrollRef}
            onWheel={handleHorizontalWheel}
            className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            aria-label='Widget header'
          >
            <div className='flex w-full flex-nowrap items-center gap-4 py-0.5 font-medium text-accent-foreground text-sm'>
              <div className='flex h-8 flex-grow basis-0 items-center justify-start gap-1 whitespace-nowrap pl-1 text-left'>
                <PairColorDropdown color={pairColor} onChange={handlePairColorSelect} />
                <WidgetSelector
                  currentKey={widgetKey}
                  onSelect={handleWidgetSelect}
                  disabled={!onWidgetChange}
                />
                {renderHeaderSlot(header?.left ?? registryHeader?.left)}
              </div>
              <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-1 whitespace-nowrap text-center'>
                {renderHeaderSlot(header?.center ?? registryHeader?.center)}
              </div>
              <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-1 whitespace-nowrap pr-1 text-right'>
                {renderHeaderSlot(header?.right ?? registryHeader?.right)}
                {onPanelSplit || onPanelSplitHorizontal || onPanelClose ? (
                  <WidgetActionMenu
                    onSplitVertical={onPanelSplit ? handlePanelSplit : undefined}
                    onSplitHorizontal={
                      onPanelSplitHorizontal ? handlePanelSplitHorizontal : undefined
                    }
                    onClose={onPanelClose ? handlePanelClose : undefined}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className='flex flex-1 flex-col overflow-hidden'>
          {WidgetComponent ? (
            <RenderWidgetComponent
              params={widget?.params ?? null}
              context={context}
              pairColor={pairColor}
              panelId={panelId}
              widget={widget}
              onWidgetChange={onWidgetChange}
              onWidgetParamsChange={onWidgetParamsChange}
            />
          ) : null}
        </div>
      </Card>
    </div>
  )
}

function renderHeaderSlot(slot?: HeaderSlotContent) {
  if (!slot) return null

  if (Array.isArray(slot)) {
    return slot.map((node, index) => (
      <Fragment key={index}>
        <span className='inline-flex items-center gap-2 whitespace-nowrap'>{node}</span>
      </Fragment>
    ))
  }

  return slot
}

function arePropsEqual(prev: WidgetSurfaceProps, next: WidgetSurfaceProps) {
  const prevWidget = prev.widget
  const nextWidget = next.widget

  const sameWidget =
    prevWidget?.key === nextWidget?.key &&
    prevWidget?.pairColor === nextWidget?.pairColor &&
    prevWidget?.params === nextWidget?.params

  return (
    sameWidget &&
    prev.panelId === next.panelId &&
    prev.context?.workspaceId === next.context?.workspaceId &&
    prev.header === next.header &&
    prev.onPairColorChange === next.onPairColorChange &&
    prev.onWidgetChange === next.onWidgetChange &&
    prev.onPanelSplit === next.onPanelSplit &&
    prev.onPanelSplitHorizontal === next.onPanelSplitHorizontal &&
    prev.onPanelClose === next.onPanelClose &&
    prev.onWidgetParamsChange === next.onWidgetParamsChange
  )
}

export const WidgetSurface = memo(WidgetSurfaceComponent, arePropsEqual)
