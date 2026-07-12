'use client'

import { Fragment, memo, type ReactNode, useCallback, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { LoadingAgent } from '@/components/ui/loading-agent'
import type { PairColor } from '@/widgets/pair-colors'
import { getWidgetDefinition } from '@/widgets/registry'
import type { WidgetComponentProps, WidgetHeaderSlots, WidgetRuntimeContext } from '@/widgets/types'
import { useDashboardWidgetRenderState } from '@/widgets/widget-config-runtime'
import { PairColorDropdown } from '@/widgets/widgets/components/pair-color-dropdown'
import { WidgetActionMenu } from '@/widgets/widgets/components/widget-action-menu'
import { WidgetSelector } from '@/widgets/widgets/components/widget-selector'

type HeaderSlotContent = ReactNode | ReactNode[]
type WidgetSurfaceHeader = Partial<WidgetHeaderSlots>

interface WidgetSurfaceProps {
  header?: WidgetSurfaceHeader
  context?: WidgetRuntimeContext
  onPairColorChange?: (color: PairColor) => void
  onWidgetChange?: (widgetKey: string) => void
  panelId?: string
  onPanelSplit?: () => void
  onPanelSplitHorizontal?: () => void
  onPanelClose?: () => void
  onWidgetParamsPatch?: (params: Record<string, unknown>) => void
  onWidgetLinkedParamsPatch?: (params: Record<string, unknown>) => void
}

function WidgetSurfaceComponent({
  header,
  context,
  onPairColorChange,
  onWidgetChange,
  panelId,
  onPanelSplit,
  onPanelSplitHorizontal,
  onPanelClose,
  onWidgetParamsPatch,
  onWidgetLinkedParamsPatch,
}: WidgetSurfaceProps) {
  const renderState = useDashboardWidgetRenderState()
  const renderWidget = renderState.renderWidget
  const widgetKey = renderState.widgetKey ?? 'empty'
  const emptyDefinition = getWidgetDefinition('empty')
  const definition = getWidgetDefinition(widgetKey) ?? emptyDefinition
  const pairColor = renderState.pairColor
  const normalizedPanelId = panelId?.trim() || 'panel'
  const channelId = pairColor === 'gray' ? `${widgetKey}-${normalizedPanelId}` : `pair-${pairColor}`
  const WidgetComponent = definition?.component ?? emptyDefinition?.component
  type RuntimeWidgetComponent = (
    props: WidgetComponentProps & {
      onWidgetChange?: (widgetKey: string) => void
    }
  ) => ReactNode
  const RenderWidgetComponent = WidgetComponent as RuntimeWidgetComponent
  const headerContext = {
    channelId,
    widget: renderWidget,
    context,
    panelId,
    canEditWidgetParams: renderState.isEffectiveParamsReady && Boolean(onWidgetParamsPatch),
  }
  const registryHeader = renderState.isEffectiveParamsReady
    ? (definition?.renderHeader?.(headerContext) ?? emptyDefinition?.renderHeader?.(headerContext))
    : undefined
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
                <PairColorDropdown
                  color={pairColor}
                  onChange={renderState.isWidgetReady ? onPairColorChange : undefined}
                />
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
          {renderState.error ? (
            <div className='flex h-full items-center justify-center px-4 text-center text-destructive text-sm'>
              {renderState.error}
            </div>
          ) : !renderState.isEffectiveParamsReady ? (
            <div className='flex h-full items-center justify-center'>
              <LoadingAgent size='md' />
            </div>
          ) : WidgetComponent ? (
            <RenderWidgetComponent
              channelId={channelId}
              params={renderWidget?.params ?? null}
              context={context}
              pairColor={pairColor}
              panelId={panelId}
              widget={renderWidget}
              onWidgetChange={onWidgetChange}
              onWidgetParamsPatch={onWidgetParamsPatch}
              onWidgetLinkedParamsPatch={onWidgetLinkedParamsPatch}
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
  return (
    prev.panelId === next.panelId &&
    prev.context?.workspaceId === next.context?.workspaceId &&
    prev.context?.dashboardLayoutOwnerUserId === next.context?.dashboardLayoutOwnerUserId &&
    prev.context?.dashboardLayoutId === next.context?.dashboardLayoutId &&
    prev.context?.dashboardLayoutName === next.context?.dashboardLayoutName &&
    prev.context?.canWrite === next.context?.canWrite &&
    prev.header === next.header &&
    prev.onPairColorChange === next.onPairColorChange &&
    prev.onWidgetChange === next.onWidgetChange &&
    prev.onPanelSplit === next.onPanelSplit &&
    prev.onPanelSplitHorizontal === next.onPanelSplitHorizontal &&
    prev.onPanelClose === next.onPanelClose &&
    prev.onWidgetParamsPatch === next.onWidgetParamsPatch &&
    prev.onWidgetLinkedParamsPatch === next.onWidgetLinkedParamsPatch
  )
}

export const WidgetSurface = memo(WidgetSurfaceComponent, arePropsEqual)
