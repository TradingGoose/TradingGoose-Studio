'use client'

import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  createDefaultLayoutState,
  createLayoutNodeId,
  type LayoutNode,
  type WidgetInstance,
} from '@/widgets/layout'
import { WidgetActionMenu } from '@/widgets/widgets/components/widget-action-menu'

const PANEL_MIN_SIZE = 10
const MIN_SPLIT_SIZE = PANEL_MIN_SIZE * 2

interface LayoutPreviewNodeProps {
  node: LayoutNode
  availableWidth?: number
  availableHeight?: number
  persistGroupSizes: (groupId: string, sizes: number[]) => void
  splitPanelVertical: (panelId: string) => void
  splitPanelHorizontal: (panelId: string) => void
  closePanel: (panelId: string) => void
}

function LayoutPreviewPanelSurface({
  availableWidth,
  availableHeight,
  onPanelSplit,
  onPanelSplitHorizontal,
  onPanelClose,
}: {
  availableWidth: number
  availableHeight: number
  onPanelSplit?: () => void
  onPanelSplitHorizontal?: () => void
  onPanelClose?: () => void
}) {
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 })

  const handleHorizontalWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!headerScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    headerScrollRef.current.scrollLeft += event.deltaY
  }, [])

  useEffect(() => {
    const element = bodyRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const update = () => {
      const { width, height } = element.getBoundingClientRect()
      setPanelSize({
        width: Math.max(0, Math.round(width)),
        height: Math.max(0, Math.round(height)),
      })
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
            aria-label='Widget header'
          >
            <div className='flex w-full flex-nowrap items-center gap-4 py-0.5 font-medium text-accent-foreground text-sm'>
              <div className='flex h-8 flex-grow basis-0 items-center justify-start gap-1 whitespace-nowrap pl-1 text-left' />
              <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-1 whitespace-nowrap text-center' />
              <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-1 whitespace-nowrap pr-1 text-right'>
                <WidgetActionMenu
                  onSplitVertical={onPanelSplit}
                  onSplitHorizontal={onPanelSplitHorizontal}
                  onClose={onPanelClose}
                />
              </div>
            </div>
          </div>
        </header>
        <div
          ref={bodyRef}
          className='flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden bg-background px-4 py-6 text-center'
        >
          <div className='space-y-1'>
            <p className='font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.24em]'>
              Widget Size
            </p>
            <p className='font-medium text-2xl text-foreground tabular-nums'>
              {formatPanelDimension(panelSize.width)} × {formatPanelDimension(panelSize.height)}
            </p>
          </div>
          <p className='text-muted-foreground text-xs tabular-nums'>
            {Math.round(availableWidth)}% width · {Math.round(availableHeight)}% height
          </p>
        </div>
      </Card>
    </div>
  )
}

const LayoutPreviewNode = memo(
  function LayoutPreviewNode({
    node,
    availableWidth = 100,
    availableHeight = 100,
    persistGroupSizes,
    splitPanelVertical,
    splitPanelHorizontal,
    closePanel,
  }: LayoutPreviewNodeProps) {
    if (node.type === 'panel') {
      const canSplitVertical = availableHeight >= MIN_SPLIT_SIZE
      const canSplitHorizontal = availableWidth >= MIN_SPLIT_SIZE

      return (
        <LayoutPreviewPanelSurface
          availableWidth={availableWidth}
          availableHeight={availableHeight}
          onPanelSplit={canSplitVertical ? () => splitPanelVertical(node.id) : undefined}
          onPanelSplitHorizontal={
            canSplitHorizontal ? () => splitPanelHorizontal(node.id) : undefined
          }
          onPanelClose={() => closePanel(node.id)}
        />
      )
    }

    return (
      <ResizablePanelGroup
        key={node.id}
        direction={node.direction}
        layout={node.sizes}
        onLayout={(sizes) => persistGroupSizes(node.id, sizes)}
        className='h-full w-full'
      >
        {node.children.map((child, index) => {
          const childSize = node.sizes[index] ?? 100 / Math.max(node.children.length, 1)
          const nextAvailableWidth =
            node.direction === 'horizontal' ? (availableWidth * childSize) / 100 : availableWidth
          const nextAvailableHeight =
            node.direction === 'vertical' ? (availableHeight * childSize) / 100 : availableHeight

          return (
            <Fragment key={`${node.id}-${child.id}`}>
              <ResizablePanel
                id={child.id}
                order={index + 1}
                defaultSize={childSize}
                minSize={PANEL_MIN_SIZE}
                collapsible
              >
                <LayoutPreviewNode
                  node={child}
                  availableWidth={nextAvailableWidth}
                  availableHeight={nextAvailableHeight}
                  persistGroupSizes={persistGroupSizes}
                  splitPanelVertical={splitPanelVertical}
                  splitPanelHorizontal={splitPanelHorizontal}
                  closePanel={closePanel}
                />
              </ResizablePanel>
              {index < node.children.length - 1 ? <ResizableHandle withHandle /> : null}
            </Fragment>
          )
        })}
      </ResizablePanelGroup>
    )
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.availableWidth === next.availableWidth &&
    prev.availableHeight === next.availableHeight
)

export function LayoutPreview() {
  const [mounted, setMounted] = useState(false)
  const [tree, setTree] = useState<LayoutNode>(() => createDefaultLayoutState())
  const skipLayoutRef = useRef<Set<string>>(new Set())

  const persistGroupSizes = useCallback((groupId: string, sizes: number[]) => {
    if (skipLayoutRef.current.has(groupId)) {
      skipLayoutRef.current.delete(groupId)
      return
    }

    setTree((prev) => updateGroupSizes(prev, groupId, sizes))
  }, [])

  const splitPanelVertical = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findParentGroupId(prev, panelId)
      const next = splitPanelIntoVerticalGroup(prev, panelId)

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const splitPanelHorizontal = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findParentGroupId(prev, panelId)
      const next = splitPanelIntoHorizontalGroup(prev, panelId)

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const closePanel = useCallback((panelId: string) => {
    setTree((prev) => closePanelGroup(prev, panelId))
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className='flex h-full min-h-[480px] w-full overflow-hidden' />
  }

  return (
    <div className='flex h-full min-h-[480px] w-full overflow-hidden'>
      <LayoutPreviewNode
        node={tree}
        persistGroupSizes={persistGroupSizes}
        splitPanelVertical={splitPanelVertical}
        splitPanelHorizontal={splitPanelHorizontal}
        closePanel={closePanel}
      />
    </div>
  )
}

function formatPanelDimension(value: number): string {
  return value > 0 ? `${value}px` : '--'
}

function updateGroupSizes(node: LayoutNode, groupId: string, sizes: number[]): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  if (node.id === groupId) {
    if (arePanelSizesEqual(node.sizes, sizes)) {
      return node
    }

    return {
      ...node,
      sizes: [...sizes],
    }
  }

  const updatedChildren = node.children.map((child) => updateGroupSizes(child, groupId, sizes))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function arePanelSizesEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (Math.abs(a[index] - b[index]) > 0.01) {
      return false
    }
  }

  return true
}

function splitPanelIntoVerticalGroup(node: LayoutNode, panelId: string): LayoutNode {
  return splitPanelIntoGroup(node, panelId, 'vertical')
}

function splitPanelIntoHorizontalGroup(node: LayoutNode, panelId: string): LayoutNode {
  return splitPanelIntoGroup(node, panelId, 'horizontal')
}

function splitPanelIntoGroup(
  node: LayoutNode,
  panelId: string,
  direction: 'vertical' | 'horizontal'
): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    return {
      id: createLayoutNodeId(),
      type: 'group',
      direction,
      sizes: [50, 50],
      children: [
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(node.widget),
        },
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(node.widget),
        },
      ],
    }
  }

  const updatedChildren = node.children.map((child) =>
    splitPanelIntoGroup(child, panelId, direction)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function closePanelGroup(node: LayoutNode, panelId: string): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  const directIndex = node.children.findIndex(
    (child) => child.type === 'panel' && child.id === panelId
  )

  if (directIndex !== -1) {
    const remainingChildren = node.children.filter((_, index) => index !== directIndex)

    if (remainingChildren.length === 0) {
      return node
    }

    if (remainingChildren.length === 1) {
      const survivor = remainingChildren[0]

      if (survivor.type === 'panel') {
        return {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(survivor.widget),
        }
      }

      return {
        ...survivor,
        id: createLayoutNodeId(),
      }
    }

    const nextSizes = normalizeRemainingSizes(node.sizes, directIndex, remainingChildren.length)

    return {
      ...node,
      id: createLayoutNodeId(),
      children: remainingChildren,
      sizes: nextSizes,
    }
  }

  const updatedChildren = node.children.map((child) => closePanelGroup(child, panelId))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function duplicateWidgetInstance(widget: WidgetInstance): WidgetInstance {
  if (!widget) {
    return {
      key: 'empty',
      pairColor: 'gray',
      params: null,
    }
  }

  return {
    key: widget.key,
    pairColor: widget.pairColor ?? 'gray',
    params: widget.params ? { ...widget.params } : null,
  }
}

function normalizeRemainingSizes(
  sizes: number[],
  removedIndex: number,
  nextLength: number
): number[] {
  if (nextLength === 0) {
    return []
  }

  const remaining = sizes.filter((_, index) => index !== removedIndex)
  const total = remaining.reduce((sum, value) => sum + value, 0)

  if (total <= 0) {
    const fallback = 100 / nextLength
    return new Array(nextLength).fill(fallback)
  }

  return remaining.map((value) => (value / total) * 100)
}

function findParentGroupId(
  node: LayoutNode,
  childId: string,
  parentId: string | null = null
): string | null {
  if (node.type === 'panel') {
    return null
  }

  if (node.children.some((child) => child.id === childId)) {
    return node.id
  }

  for (const child of node.children) {
    const found = findParentGroupId(child, childId, node.id)
    if (found) {
      return found
    }
  }

  return parentId
}
