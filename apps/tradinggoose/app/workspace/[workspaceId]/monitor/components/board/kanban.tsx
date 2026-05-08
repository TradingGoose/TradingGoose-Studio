'use client'

import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type KanbanDropDirection = 'none' | 'top' | 'bottom'

type KanbanDragLocation = {
  columnId: string
  cardId: string | null
  direction: KanbanDropDirection
}

type KanbanCardData = {
  id: string
  columnId: string
}

export type KanbanDragEvent<TItem extends KanbanCardData = KanbanCardData> = {
  activeItem: TItem
  activeLocation: KanbanDragLocation
  overLocation: KanbanDragLocation | null
  activeColumnId: string
  overColumnId: string | null
}

type KanbanDndMonitorEventHandler<TItem extends KanbanCardData = KanbanCardData> = {
  onDragStart?: (event: KanbanDragEvent<TItem>) => void
  onDragMove?: (event: KanbanDragEvent<TItem>) => void
  onDragOver?: (event: KanbanDragEvent<TItem>) => void
  onDragEnd?: (event: KanbanDragEvent<TItem>) => void
  onDragCancel?: (event: KanbanDragEvent<TItem>) => void
}

type KanbanDndEventType = keyof KanbanDndMonitorEventHandler

type KanbanContextValue = {
  draggableDescribedById: string
  overTarget: KanbanDragLocation | null
  registerColumnItems: (columnId: string, itemIds: string[]) => void
  unregisterColumnItems: (columnId: string) => void
  registerColumnDropHandler: (columnId: string, handler: (activeId: string) => void) => void
  unregisterColumnDropHandler: (columnId: string) => void
  registerItemDropHandler: (
    cardId: string,
    handler: (activeId: string, direction: KanbanDropDirection) => void
  ) => void
  unregisterItemDropHandler: (cardId: string) => void
  registerCardOverlay: (cardId: string, render: () => ReactNode) => void
  unregisterCardOverlay: (cardId: string) => void
  registerMonitor: (monitor: KanbanDndMonitorEventHandler) => void
  unregisterMonitor: (monitor: KanbanDndMonitorEventHandler) => void
  triggerEvent: (eventType: KanbanDndEventType, event: KanbanDragEvent) => void
}

const kanbanContext = createContext<KanbanContextValue | undefined>(undefined)

const defaultScreenReaderInstructions = `
To pick up a draggable item, press the space bar.
While dragging, move the pointer over another item or column.
Release to drop the item in its new position, or press escape to cancel.
`

const defaultAnnouncements = {
  onDragStart(event: KanbanDragEvent) {
    return `Picked up item ${event.activeItem.id}.`
  },
  onDragOver(event: KanbanDragEvent) {
    const overId = event.overLocation?.cardId ?? event.overLocation?.columnId
    if (overId) {
      return `Item ${event.activeItem.id} moved over ${overId}.`
    }

    return `Item ${event.activeItem.id} is no longer over a drop target.`
  },
  onDragEnd(event: KanbanDragEvent) {
    const overId = event.overLocation?.cardId ?? event.overLocation?.columnId
    if (overId) {
      return `Item ${event.activeItem.id} dropped over ${overId}.`
    }

    return `Item ${event.activeItem.id} was dropped.`
  },
  onDragCancel(event: KanbanDragEvent) {
    return `Dragging item ${event.activeItem.id} was cancelled.`
  },
} satisfies {
  onDragStart: (event: KanbanDragEvent) => string
  onDragOver: (event: KanbanDragEvent) => string
  onDragEnd: (event: KanbanDragEvent) => string
  onDragCancel: (event: KanbanDragEvent) => string
}

const toStringId = (id: UniqueIdentifier | undefined | null) =>
  typeof id === 'string' ? id : id == null ? '' : String(id)

function useKanbanContext() {
  const context = useContext(kanbanContext)

  if (!context) {
    throw new Error('Kanban components must be rendered inside KanbanProvider.')
  }

  return context
}

function useDndMonitor(monitor: KanbanDndMonitorEventHandler) {
  const { registerMonitor, unregisterMonitor } = useKanbanContext()

  useEffect(() => {
    registerMonitor(monitor)

    return () => {
      unregisterMonitor(monitor)
    }
  }, [monitor, registerMonitor, unregisterMonitor])
}

function KanbanHiddenText({ id, value }: { id: string; value: string }) {
  return (
    <div id={id} className='hidden'>
      {value}
    </div>
  )
}

function KanbanLiveRegion({ announcement, id }: { announcement: string; id: string }) {
  return (
    <div
      aria-atomic
      aria-live='assertive'
      className='-m-px fixed top-0 left-0 h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip-path:inset(100%)]'
      id={id}
      role='status'
    >
      {announcement}
    </div>
  )
}

function KanbanAccessibility({
  container,
  screenReaderInstructions = defaultScreenReaderInstructions,
}: {
  container?: Element
  screenReaderInstructions?: string
}) {
  const hiddenTextId = useKanbanContext().draggableDescribedById
  const liveRegionId = useId()
  const [mounted, setMounted] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  useDndMonitor(
    useMemo(
      () => ({
        onDragStart(event) {
          setAnnouncement(defaultAnnouncements.onDragStart(event))
        },
        onDragOver(event) {
          setAnnouncement(defaultAnnouncements.onDragOver(event))
        },
        onDragEnd(event) {
          setAnnouncement(defaultAnnouncements.onDragEnd(event))
        },
        onDragCancel(event) {
          setAnnouncement(defaultAnnouncements.onDragCancel(event))
        },
      }),
      []
    )
  )

  if (!mounted) {
    return null
  }

  const markup = (
    <>
      <KanbanHiddenText id={hiddenTextId} value={screenReaderInstructions} />
      <KanbanLiveRegion id={liveRegionId} announcement={announcement} />
    </>
  )

  return container ? createPortal(markup, container) : markup
}

type KanbanDndEvent =
  | DragMoveEvent
  | DragOverEvent
  | DragEndEvent
  | DragStartEvent
  | DragCancelEvent

type KanbanItemEventData<TItem extends KanbanCardData = KanbanCardData> = {
  type?: unknown
  columnId?: unknown
  cardId?: unknown
  item?: TItem
}

const getDropDirection = (
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  cardOrderByColumn: Map<string, string[]>
): KanbanDropDirection => {
  const overRect = event.over?.rect
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial
  if (overRect && activeRect) {
    const activeCenterY = activeRect.top + activeRect.height / 2
    const overCenterY = overRect.top + overRect.height / 2
    return activeCenterY <= overCenterY ? 'top' : 'bottom'
  }

  const activeData = event.active.data.current as KanbanItemEventData | undefined
  const overData = event.over?.data.current as KanbanItemEventData | undefined
  if (
    activeData?.type !== 'card' ||
    overData?.type !== 'card' ||
    typeof activeData.columnId !== 'string' ||
    typeof activeData.cardId !== 'string' ||
    typeof overData.columnId !== 'string' ||
    typeof overData.cardId !== 'string' ||
    activeData.columnId !== overData.columnId
  ) {
    return 'none'
  }

  const itemIds = cardOrderByColumn.get(activeData.columnId) ?? []
  const activeIndex = itemIds.indexOf(activeData.cardId)
  const overIndex = itemIds.indexOf(overData.cardId)
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return 'none'

  return activeIndex < overIndex ? 'bottom' : 'top'
}

const getDropTarget = (
  event: DragMoveEvent | DragOverEvent | DragEndEvent,
  cardOrderByColumn: Map<string, string[]>
): KanbanDragLocation | null => {
  const data = event.over?.data.current as KanbanItemEventData | undefined

  if (data?.type === 'column' && typeof data.columnId === 'string') {
    return { columnId: data.columnId, cardId: null, direction: 'none' }
  }

  if (
    data?.type === 'card' &&
    typeof data.columnId === 'string' &&
    typeof data.cardId === 'string'
  ) {
    return {
      columnId: data.columnId,
      cardId: data.cardId,
      direction: getDropDirection(event, cardOrderByColumn),
    }
  }

  return null
}

const getActiveItem = <TItem extends KanbanCardData>(event: KanbanDndEvent): TItem => {
  const activeId = toStringId(event.active.id)
  const data = event.active.data.current as KanbanItemEventData<TItem> | undefined

  if (
    data?.type === 'card' &&
    typeof data.columnId === 'string' &&
    typeof data.cardId === 'string' &&
    data.item
  ) {
    return data.item
  }

  return {
    id: activeId,
    columnId: typeof data?.columnId === 'string' ? data.columnId : '',
  } as TItem
}

const buildKanbanDragEvent = <TItem extends KanbanCardData>(
  event: KanbanDndEvent,
  cardOrderByColumn: Map<string, string[]>
): KanbanDragEvent<TItem> => {
  const activeItem = getActiveItem<TItem>(event)
  const activeLocation: KanbanDragLocation = {
    columnId: activeItem.columnId,
    cardId: activeItem.id,
    direction: 'none',
  }
  const overLocation =
    'over' in event && event.over ? getDropTarget(event, cardOrderByColumn) : null

  return {
    activeItem,
    activeLocation,
    overLocation,
    activeColumnId: activeLocation.columnId,
    overColumnId: overLocation?.columnId ?? null,
  }
}

type KanbanProviderProps<TItem extends KanbanCardData = KanbanCardData> = {
  children: ReactNode
  container?: Element
  onDragCancel?: (event: KanbanDragEvent<TItem>) => void
  onDragEnd?: (event: KanbanDragEvent<TItem>) => void
  onDragMove?: (event: KanbanDragEvent<TItem>) => void
  onDragOver?: (event: KanbanDragEvent<TItem>) => void
  onDragStart?: (event: KanbanDragEvent<TItem>) => void
}

export function KanbanProvider<TItem extends KanbanCardData = KanbanCardData>({
  children,
  container,
  onDragCancel,
  onDragEnd,
  onDragMove,
  onDragOver,
  onDragStart,
}: KanbanProviderProps<TItem>) {
  const draggableDescribedById = useId()
  const monitorsReference = useRef<KanbanDndMonitorEventHandler<TItem>[]>([])
  const cardOrderByColumn = useRef(new Map<string, string[]>())
  const columnDropHandlers = useRef(new Map<string, (activeId: string) => void>())
  const itemDropHandlers = useRef(
    new Map<string, (activeId: string, direction: KanbanDropDirection) => void>()
  )
  const cardOverlayRenderers = useRef(new Map<string, () => ReactNode>())
  const [activeOverlayId, setActiveOverlayId] = useState('')
  const [overTarget, setOverTarget] = useState<KanbanDragLocation | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const registerMonitor = useCallback((monitor: KanbanDndMonitorEventHandler) => {
    monitorsReference.current.push(monitor as KanbanDndMonitorEventHandler<TItem>)
  }, [])

  const unregisterMonitor = useCallback((monitor: KanbanDndMonitorEventHandler) => {
    monitorsReference.current = monitorsReference.current.filter((entry) => entry !== monitor)
  }, [])

  const registerColumnItems = useCallback((columnId: string, itemIds: string[]) => {
    cardOrderByColumn.current.set(columnId, itemIds)
  }, [])

  const unregisterColumnItems = useCallback((columnId: string) => {
    cardOrderByColumn.current.delete(columnId)
  }, [])

  const registerColumnDropHandler = useCallback(
    (columnId: string, handler: (activeId: string) => void) => {
      columnDropHandlers.current.set(columnId, handler)
    },
    []
  )

  const unregisterColumnDropHandler = useCallback((columnId: string) => {
    columnDropHandlers.current.delete(columnId)
  }, [])

  const registerItemDropHandler = useCallback(
    (cardId: string, handler: (activeId: string, direction: KanbanDropDirection) => void) => {
      itemDropHandlers.current.set(cardId, handler)
    },
    []
  )

  const unregisterItemDropHandler = useCallback((cardId: string) => {
    itemDropHandlers.current.delete(cardId)
  }, [])

  const registerCardOverlay = useCallback((cardId: string, render: () => ReactNode) => {
    cardOverlayRenderers.current.set(cardId, render)
  }, [])

  const unregisterCardOverlay = useCallback((cardId: string) => {
    cardOverlayRenderers.current.delete(cardId)
  }, [])

  const triggerEvent = useCallback((eventType: KanbanDndEventType, event: KanbanDragEvent) => {
    monitorsReference.current.forEach((monitor) => {
      monitor[eventType]?.(event as KanbanDragEvent<TItem>)
    })
  }, [])

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const dragEvent = buildKanbanDragEvent<TItem>(event, cardOrderByColumn.current)
      setActiveOverlayId(dragEvent.activeItem.id)
      triggerEvent('onDragStart', dragEvent)
      onDragStart?.(dragEvent)
    },
    [onDragStart, triggerEvent]
  )

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const dragEvent = buildKanbanDragEvent<TItem>(event, cardOrderByColumn.current)
      setOverTarget(dragEvent.overLocation)
      triggerEvent('onDragMove', dragEvent)
      onDragMove?.(dragEvent)
    },
    [onDragMove, triggerEvent]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const dragEvent = buildKanbanDragEvent<TItem>(event, cardOrderByColumn.current)
      setOverTarget(dragEvent.overLocation)
      triggerEvent('onDragOver', dragEvent)
      onDragOver?.(dragEvent)
    },
    [onDragOver, triggerEvent]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const dragEvent = buildKanbanDragEvent<TItem>(event, cardOrderByColumn.current)
      const target = dragEvent.overLocation

      if (target?.cardId) {
        itemDropHandlers.current.get(target.cardId)?.(dragEvent.activeItem.id, target.direction)
      } else if (target) {
        columnDropHandlers.current.get(target.columnId)?.(dragEvent.activeItem.id)
      }

      setActiveOverlayId('')
      setOverTarget(null)
      triggerEvent('onDragEnd', dragEvent)
      onDragEnd?.(dragEvent)
    },
    [onDragEnd, triggerEvent]
  )

  const handleDragCancel = useCallback(
    (event: DragCancelEvent) => {
      const dragEvent = buildKanbanDragEvent<TItem>(event, cardOrderByColumn.current)
      setActiveOverlayId('')
      setOverTarget(null)
      triggerEvent('onDragCancel', dragEvent)
      onDragCancel?.(dragEvent)
    },
    [onDragCancel, triggerEvent]
  )

  const contextValue = useMemo(
    () => ({
      draggableDescribedById,
      overTarget,
      registerColumnItems,
      unregisterColumnItems,
      registerColumnDropHandler,
      unregisterColumnDropHandler,
      registerItemDropHandler,
      registerCardOverlay,
      unregisterItemDropHandler,
      unregisterCardOverlay,
      registerMonitor,
      unregisterMonitor,
      triggerEvent,
    }),
    [
      draggableDescribedById,
      overTarget,
      registerColumnItems,
      registerColumnDropHandler,
      registerCardOverlay,
      registerItemDropHandler,
      registerMonitor,
      triggerEvent,
      unregisterCardOverlay,
      unregisterColumnItems,
      unregisterColumnDropHandler,
      unregisterItemDropHandler,
      unregisterMonitor,
    ]
  )
  const activeOverlay = activeOverlayId
    ? (cardOverlayRenderers.current.get(activeOverlayId)?.() ?? null)
    : null

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <kanbanContext.Provider value={contextValue}>
        {children}
        <KanbanAccessibility container={container} />
        <DragOverlay>{activeOverlay}</DragOverlay>
      </kanbanContext.Provider>
    </DndContext>
  )
}

export function KanbanBoard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 items-start gap-4 overflow-x-auto overflow-y-hidden pb-2',
        className
      )}
      {...props}
    />
  )
}

function KanbanHeader({
  columnId,
  count,
  title,
}: {
  columnId: string
  count: number
  title: string
}) {
  return (
    <header className='flex items-center justify-between border-b px-4 py-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <h2 className='truncate font-medium text-sm' id={`column-${columnId}-title`}>
          {title}
        </h2>
        <Badge variant='secondary' className='text-[11px]'>
          {count}
        </Badge>
      </div>
    </header>
  )
}

export function KanbanCards({
  beforeCards,
  canDrop = false,
  children,
  className,
  columnId,
  count,
  itemIds = [],
  listClassName,
  onDropOverColumn,
  title,
}: {
  canDrop?: boolean
  children: ReactNode
  className?: string
  beforeCards?: ReactNode
  columnId: string
  count: number
  itemIds?: string[]
  listClassName?: string
  onDropOverColumn?: (activeId: string) => void
  title: string
}) {
  const {
    overTarget,
    registerColumnDropHandler,
    registerColumnItems,
    unregisterColumnDropHandler,
    unregisterColumnItems,
  } = useKanbanContext()
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${columnId}`,
    data: { type: 'column', columnId },
    disabled: !canDrop,
  })
  const isDropTarget =
    canDrop && isOver && overTarget?.cardId === null && overTarget.columnId === columnId

  useEffect(() => {
    registerColumnItems(columnId, itemIds)
    return () => unregisterColumnItems(columnId)
  }, [columnId, itemIds, registerColumnItems, unregisterColumnItems])

  useEffect(() => {
    if (!onDropOverColumn) return
    registerColumnDropHandler(columnId, onDropOverColumn)
    return () => unregisterColumnDropHandler(columnId)
  }, [columnId, onDropOverColumn, registerColumnDropHandler, unregisterColumnDropHandler])

  return (
    <section
      aria-labelledby={`column-${columnId}-title`}
      className={cn(
        'flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card/60',
        isDropTarget && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
        className
      )}
      ref={setNodeRef}
    >
      <KanbanHeader columnId={columnId} title={title} count={count} />
      {beforeCards}
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <ul className={cn('min-h-0 flex-1 overflow-y-auto p-3', listClassName)}>{children}</ul>
      </SortableContext>
    </section>
  )
}

export const KanbanCard = forwardRef<
  HTMLElement,
  ComponentProps<'article'> & {
    data: KanbanCardData
    disabled?: boolean
    isActive?: boolean
    itemClassName?: string
    onDropOverCard?: (activeId: string, dropDirection: KanbanDropDirection) => void
    selected?: boolean
  }
>(
  (
    {
      children,
      className,
      data,
      disabled = false,
      isActive = false,
      itemClassName,
      onDropOverCard,
      selected = false,
      onDragEnd: _onDragEnd,
      onDragStart: _onDragStart,
      style,
      ...props
    },
    ref
  ) => {
    const internalReference = useRef<HTMLElement | null>(null)
    const {
      draggableDescribedById,
      overTarget,
      registerCardOverlay,
      registerItemDropHandler,
      unregisterCardOverlay,
      unregisterItemDropHandler,
    } = useKanbanContext()
    const dropDirection = overTarget?.cardId === data.id ? overTarget.direction : 'none'
    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
      id: data.id,
      data: { type: 'card', columnId: data.columnId, cardId: data.id, item: data },
      disabled,
    })
    const {
      'aria-describedby': _ariaDescribedBy,
      'aria-roledescription': _ariaRoleDescription,
      role: _role,
      tabIndex: _tabIndex,
      ...draggableAttributes
    } = attributes

    const setCombinedRef = useCallback(
      (node: HTMLElement | null) => {
        internalReference.current = node
        setNodeRef(node)
      },
      [setNodeRef]
    )

    useImperativeHandle(ref, () => internalReference.current!)

    const nextStyle: CSSProperties = {
      ...style,
      transform: CSS.Translate.toString(transform),
      transition,
    }

    useEffect(() => {
      registerCardOverlay(data.id, () => (
        <article
          aria-hidden='true'
          className={cn(
            'rounded-xl border bg-background px-3 py-3 text-left shadow-lg',
            selected && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
            className
          )}
        >
          {children}
        </article>
      ))

      return () => {
        unregisterCardOverlay(data.id)
      }
    }, [children, className, data.id, registerCardOverlay, selected, unregisterCardOverlay])

    useEffect(() => {
      if (!onDropOverCard) return
      registerItemDropHandler(data.id, onDropOverCard)
      return () => unregisterItemDropHandler(data.id)
    }, [data.id, onDropOverCard, registerItemDropHandler, unregisterItemDropHandler])

    return (
      <li
        className={cn(
          '-mb-[2px] border-t-2 border-t-transparent border-b-2 border-b-transparent py-1 last:mb-0',
          dropDirection === 'top' && 'border-t-primary',
          dropDirection === 'bottom' && 'border-b-primary',
          itemClassName
        )}
      >
        <article
          aria-describedby={draggableDescribedById}
          aria-roledescription={disabled ? undefined : 'draggable'}
          className={cn(
            'rounded-xl border bg-background shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            !disabled && 'cursor-grab active:cursor-grabbing',
            selected && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
            isDragging && 'opacity-50 shadow-lg',
            isActive && 'rotate-1 shadow-lg',
            className
          )}
          ref={setCombinedRef}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: The card remains semantic content while dnd-kit supplies button-like drag affordances.
          role='button'
          style={nextStyle}
          tabIndex={0}
          {...draggableAttributes}
          {...listeners}
          {...props}
        >
          {children}
        </article>
      </li>
    )
  }
)
KanbanCard.displayName = 'KanbanCard'
