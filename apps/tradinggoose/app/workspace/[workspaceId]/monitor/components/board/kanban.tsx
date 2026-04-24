'use client'

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export type KanbanDndMonitorEventHandler = {
  onDragStart?: (activeId: string) => void
  onDragMove?: (activeId: string, overId?: string) => void
  onDragOver?: (activeId: string, overId?: string) => void
  onDragEnd?: (activeId: string, overId?: string) => void
  onDragCancel?: (activeId: string) => void
}

type KanbanDndEventType = keyof KanbanDndMonitorEventHandler

type KanbanContextValue = {
  activeIdRef: RefObject<string>
  draggableDescribedById: string
  registerMonitor: (monitor: KanbanDndMonitorEventHandler) => void
  unregisterMonitor: (monitor: KanbanDndMonitorEventHandler) => void
  triggerEvent: (eventType: KanbanDndEventType, activeId: string, overId?: string) => void
}

const kanbanContext = createContext<KanbanContextValue | undefined>(undefined)

const DATA_TRANSFER_TYPES = {
  card: 'monitor-kanban-card',
}

type KanbanCardData = {
  id: string
}

const readCardTransferData = (value: string): KanbanCardData | null => {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as { id?: unknown }
    return typeof parsed.id === 'string' && parsed.id.trim().length > 0
      ? { id: parsed.id.trim() }
      : null
  } catch {
    return null
  }
}

const defaultScreenReaderInstructions = `
To pick up a draggable item, press the space bar.
While dragging, use the arrow keys to move the item.
Press space again to drop the item in its new position, or press escape to cancel.
`

const defaultAnnouncements = {
  onDragStart(activeId: string) {
    return `Picked up monitor ${activeId}.`
  },
  onDragOver(activeId: string, overId?: string) {
    if (overId) {
      return `Monitor ${activeId} moved over ${overId}.`
    }

    return `Monitor ${activeId} is no longer over a drop target.`
  },
  onDragEnd(activeId: string, overId?: string) {
    if (overId) {
      return `Monitor ${activeId} dropped over ${overId}.`
    }

    return `Monitor ${activeId} was dropped.`
  },
  onDragCancel(activeId: string) {
    return `Dragging monitor ${activeId} was cancelled.`
  },
} satisfies {
  onDragStart: (activeId: string) => string
  onDragOver: (activeId: string, overId?: string) => string
  onDragEnd: (activeId: string, overId?: string) => string
  onDragCancel: (activeId: string) => string
}

function useKanbanContext() {
  const context = useContext(kanbanContext)

  if (!context) {
    throw new Error('Kanban components must be rendered inside KanbanBoardProvider.')
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

export function useDndEvents() {
  const { activeIdRef, draggableDescribedById, triggerEvent } = useKanbanContext()

  const onDragStart = useCallback(
    (activeId: string) => {
      activeIdRef.current = activeId
      triggerEvent('onDragStart', activeId)
    },
    [activeIdRef, triggerEvent]
  )

  const onDragMove = useCallback(
    (activeId: string, overId?: string) => {
      triggerEvent('onDragMove', activeId, overId)
    },
    [triggerEvent]
  )

  const onDragOver = useCallback(
    (activeId: string, overId?: string) => {
      triggerEvent('onDragOver', activeId || activeIdRef.current, overId)
    },
    [activeIdRef, triggerEvent]
  )

  const onDragEnd = useCallback(
    (activeId: string, overId?: string) => {
      activeIdRef.current = ''
      triggerEvent('onDragEnd', activeId, overId)
    },
    [activeIdRef, triggerEvent]
  )

  const onDragCancel = useCallback(
    (activeId: string) => {
      activeIdRef.current = ''
      triggerEvent('onDragCancel', activeId)
    },
    [activeIdRef, triggerEvent]
  )

  return {
    draggableDescribedById,
    onDragStart,
    onDragMove,
    onDragOver,
    onDragEnd,
    onDragCancel,
  }
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
      className='fixed top-0 left-0 -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip-path:inset(100%)]'
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
        onDragStart(activeId) {
          setAnnouncement(defaultAnnouncements.onDragStart(activeId))
        },
        onDragOver(activeId, overId) {
          setAnnouncement(defaultAnnouncements.onDragOver(activeId, overId))
        },
        onDragEnd(activeId, overId) {
          setAnnouncement(defaultAnnouncements.onDragEnd(activeId, overId))
        },
        onDragCancel(activeId) {
          setAnnouncement(defaultAnnouncements.onDragCancel(activeId))
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

export function KanbanBoardProvider({
  children,
  container,
}: {
  children: ReactNode
  container?: Element
}) {
  const draggableDescribedById = useId()
  const monitorsReference = useRef<KanbanDndMonitorEventHandler[]>([])
  const activeIdReference = useRef('')

  const registerMonitor = useCallback((monitor: KanbanDndMonitorEventHandler) => {
    monitorsReference.current.push(monitor)
  }, [])

  const unregisterMonitor = useCallback((monitor: KanbanDndMonitorEventHandler) => {
    monitorsReference.current = monitorsReference.current.filter((entry) => entry !== monitor)
  }, [])

  const triggerEvent = useCallback(
    (eventType: KanbanDndEventType, activeId: string, overId?: string) => {
      monitorsReference.current.forEach((monitor) => {
        monitor[eventType]?.(activeId, overId)
      })
    },
    []
  )

  const contextValue = useMemo(
    () => ({
      activeIdRef: activeIdReference,
      draggableDescribedById,
      registerMonitor,
      unregisterMonitor,
      triggerEvent,
    }),
    [draggableDescribedById, registerMonitor, triggerEvent, unregisterMonitor]
  )

  return (
    <kanbanContext.Provider value={contextValue}>
      {children}
      <KanbanAccessibility container={container} />
    </kanbanContext.Provider>
  )
}

export function KanbanBoard({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex h-full min-h-0 min-w-0 items-start gap-4 overflow-x-auto overflow-y-hidden pb-2', className)}
      {...props}
    />
  )
}

export function KanbanColumns({
  className,
  ...props
}: ComponentProps<'div'>) {
  return <div className={cn('contents', className)} {...props} />
}

export function KanbanColumn({
  canDrop = false,
  children,
  className,
  columnId,
  count,
  onDropOverColumn,
  title,
}: {
  canDrop?: boolean
  children: ReactNode
  className?: string
  columnId: string
  count: number
  onDropOverColumn?: (dataTransferData: string) => void
  title: string
}) {
  const [isDropTarget, setIsDropTarget] = useState(false)
  const { onDragEnd, onDragOver } = useDndEvents()

  return (
    <section
      aria-labelledby={`column-${columnId}-title`}
      className={cn(
        'flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border bg-card/60',
        canDrop && isDropTarget && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]',
        className
      )}
      onDragLeave={() => {
        setIsDropTarget(false)
      }}
      onDragOver={(event) => {
        if (!canDrop || !event.dataTransfer.types.includes(DATA_TRANSFER_TYPES.card)) {
          return
        }

        event.preventDefault()
        setIsDropTarget(true)
        onDragOver('', columnId)
      }}
      onDrop={(event) => {
        if (!canDrop) {
          return
        }

        const data = event.dataTransfer.getData(DATA_TRANSFER_TYPES.card)
        const card = readCardTransferData(data)

        if (!card) {
          setIsDropTarget(false)
          return
        }

        onDropOverColumn?.(data)
        onDragEnd(card.id, columnId)
        setIsDropTarget(false)
      }}
    >
      <header className='flex items-center justify-between border-b px-4 py-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <h2 className='truncate font-medium text-sm' id={`column-${columnId}-title`}>
            {title}
          </h2>
          <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
            {count}
          </span>
        </div>
      </header>
      {children}
    </section>
  )
}

export function KanbanColumnList({
  className,
  ...props
}: ComponentProps<'ul'>) {
  return <ul className={cn('min-h-0 flex-1 overflow-y-auto p-3', className)} {...props} />
}

export type KanbanDropDirection = 'none' | 'top' | 'bottom'

export function KanbanColumnListItem({
  canDrop = true,
  cardId,
  children,
  className,
  onDropOverListItem,
}: {
  canDrop?: boolean
  cardId: string
  children: ReactNode
  className?: string
  onDropOverListItem?: (dataTransferData: string, dropDirection: KanbanDropDirection) => void
}) {
  const [dropDirection, setDropDirection] = useState<KanbanDropDirection>('none')
  const { onDragEnd, onDragOver } = useDndEvents()

  return (
    <li
      className={cn(
        '-mb-[2px] border-t-2 border-b-2 border-t-transparent border-b-transparent py-1 last:mb-0',
        dropDirection === 'top' && 'border-t-primary',
        dropDirection === 'bottom' && 'border-b-primary',
        className
      )}
      onDragLeave={() => {
        setDropDirection('none')
      }}
      onDragOver={(event) => {
        if (!canDrop || !event.dataTransfer.types.includes(DATA_TRANSFER_TYPES.card)) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        const rect = event.currentTarget.getBoundingClientRect()
        const midpoint = (rect.top + rect.bottom) / 2

        setDropDirection(event.clientY <= midpoint ? 'top' : 'bottom')
        onDragOver('', cardId)
      }}
      onDrop={(event) => {
        if (!canDrop) {
          return
        }

        event.stopPropagation()

        const data = event.dataTransfer.getData(DATA_TRANSFER_TYPES.card)
        const card = readCardTransferData(data)

        if (!card) {
          setDropDirection('none')
          return
        }

        onDropOverListItem?.(data, dropDirection)
        onDragEnd(card.id, cardId)
        setDropDirection('none')
      }}
    >
      {children}
    </li>
  )
}

export const KanbanCard = forwardRef<
  HTMLElement,
  ComponentProps<'article'> & {
    data: KanbanCardData
    disabled?: boolean
    isActive?: boolean
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
      selected = false,
      onDragEnd,
      onDragStart: onDragStartProp,
      ...props
    },
    ref
  ) => {
    const internalReference = useRef<HTMLElement | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const { draggableDescribedById, onDragCancel, onDragStart } = useDndEvents()

    useImperativeHandle(ref, () => internalReference.current!)

    return (
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
        draggable={!disabled}
        onDragStart={(event) => {
          if (disabled) return

          setIsDragging(true)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData(DATA_TRANSFER_TYPES.card, JSON.stringify(data))
          onDragStart(data.id)
          onDragStartProp?.(event)
        }}
        onDragEnd={(event) => {
          setIsDragging(false)

          if (event.dataTransfer.dropEffect === 'none') {
            onDragCancel(data.id)
          }

          onDragEnd?.(event)
        }}
        ref={internalReference}
        role='button'
        tabIndex={0}
        {...props}
      >
        {children}
      </article>
    )
  }
)
KanbanCard.displayName = 'KanbanCard'
