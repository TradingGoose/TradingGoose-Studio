'use client'

import * as React from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import {
  type Announcements,
  closestCenter,
  closestCorners,
  DndContext,
  type DndContextProps,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  type ScreenReaderInstructions,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  type SortableContextProps,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as ReactDOM from 'react-dom'
import { useComposedRefs } from '@/lib/compose-refs'
import { cn } from '@/lib/utils'

const orientationConfig = {
  vertical: {
    modifiers: [restrictToVerticalAxis, restrictToParentElement],
    strategy: verticalListSortingStrategy,
    collisionDetection: closestCenter,
  },
  horizontal: {
    modifiers: [restrictToHorizontalAxis, restrictToParentElement],
    strategy: horizontalListSortingStrategy,
    collisionDetection: closestCenter,
  },
  mixed: {
    modifiers: [restrictToParentElement],
    strategy: undefined,
    collisionDetection: closestCorners,
  },
}

const ROOT_NAME = 'Sortable'
const CONTENT_NAME = 'SortableContent'
const ITEM_NAME = 'SortableItem'
const OVERLAY_NAME = 'SortableOverlay'

interface SortableRootContextValue<T> {
  id: string
  items: UniqueIdentifier[]
  modifiers: DndContextProps['modifiers']
  strategy: SortableContextProps['strategy']
  activeId: UniqueIdentifier | null
  setActiveId: (id: UniqueIdentifier | null) => void
  getItemValue: (item: T) => UniqueIdentifier
  flatCursor: boolean
}

const SortableRootContext = React.createContext<SortableRootContextValue<unknown> | null>(null)

function useSortableContext(consumerName: string) {
  const context = React.useContext(SortableRootContext)
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``)
  }
  return context
}

interface GetItemValue<T> {
  /**
   * Callback that returns a unique identifier for each sortable item. Required for array of objects.
   * @example getItemValue={(item) => item.id}
   */
  getItemValue: (item: T) => UniqueIdentifier
}

type SortableRootProps<T> = DndContextProps &
  (T extends object ? GetItemValue<T> : Partial<GetItemValue<T>>) & {
    value: T[]
    onValueChange?: (items: T[]) => void
    onMove?: (event: DragEndEvent & { activeIndex: number; overIndex: number }) => void
    strategy?: SortableContextProps['strategy']
    orientation?: 'vertical' | 'horizontal' | 'mixed'
    flatCursor?: boolean
  }

function SortableRoot<T>(props: SortableRootProps<T>) {
  const {
    value,
    onValueChange,
    collisionDetection,
    modifiers,
    strategy,
    onMove,
    orientation = 'vertical',
    flatCursor = false,
    getItemValue: getItemValueProp,
    accessibility,
    sensors: sensorsProp,
    ...sortableProps
  } = props

  const id = React.useId()
  const [activeId, setActiveId] = React.useState<UniqueIdentifier | null>(null)

  const defaultSensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const sensors = sensorsProp ?? defaultSensors
  const config = React.useMemo(() => orientationConfig[orientation], [orientation])

  const getItemValue = React.useCallback(
    (item: T): UniqueIdentifier => {
      if (typeof item === 'object' && !getItemValueProp) {
        throw new Error('getItemValue is required when using array of objects')
      }
      return getItemValueProp ? getItemValueProp(item) : (item as UniqueIdentifier)
    },
    [getItemValueProp]
  )

  const items = React.useMemo(() => {
    return value.map((item) => getItemValue(item))
  }, [value, getItemValue])

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      sortableProps.onDragStart?.(event)

      if (event.activatorEvent.defaultPrevented) return

      setActiveId(event.active.id)
    },
    [sortableProps.onDragStart]
  )

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      sortableProps.onDragEnd?.(event)

      if (event.activatorEvent.defaultPrevented) return

      const { active, over } = event
      if (over && active.id !== over?.id) {
        const activeIndex = value.findIndex((item) => getItemValue(item) === active.id)
        const overIndex = value.findIndex((item) => getItemValue(item) === over.id)

        if (onMove) {
          onMove({ ...event, activeIndex, overIndex })
        } else {
          onValueChange?.(arrayMove(value, activeIndex, overIndex))
        }
      }
      setActiveId(null)
    },
    [value, onValueChange, onMove, getItemValue, sortableProps.onDragEnd]
  )

  const onDragCancel = React.useCallback(
    (event: DragEndEvent) => {
      sortableProps.onDragCancel?.(event)

      if (event.activatorEvent.defaultPrevented) return

      setActiveId(null)
    },
    [sortableProps.onDragCancel]
  )

  const announcements: Announcements = React.useMemo(
    () => ({
      onDragStart({ active }) {
        const activeValue = active.id.toString()
        return `Grabbed sortable item "${activeValue}". Current position is ${items.indexOf(active.id) + 1} of ${items.length}. Use arrow keys to move, space to drop.`
      },
      onDragOver({ active, over }) {
        if (over) {
          const overIndex = items.indexOf(over.id)
          const activeIndex = items.indexOf(active.id)
          const moveDirection = overIndex > activeIndex ? 'down' : 'up'
          const activeValue = active.id.toString()
          return `Sortable item "${activeValue}" moved ${moveDirection} to position ${overIndex + 1} of ${items.length}.`
        }
        return 'Sortable item is no longer over a droppable area. Press escape to cancel.'
      },
      onDragEnd({ active, over }) {
        const activeValue = active.id.toString()
        if (over) {
          const overIndex = items.indexOf(over.id)
          return `Sortable item "${activeValue}" dropped at position ${overIndex + 1} of ${items.length}.`
        }
        return `Sortable item "${activeValue}" dropped. No changes were made.`
      },
      onDragCancel({ active }) {
        const activeIndex = items.indexOf(active.id)
        const activeValue = active.id.toString()
        return `Sorting cancelled. Sortable item "${activeValue}" returned to position ${activeIndex + 1} of ${items.length}.`
      },
      onDragMove({ active, over }) {
        if (over) {
          const overIndex = items.indexOf(over.id)
          const activeIndex = items.indexOf(active.id)
          const moveDirection = overIndex > activeIndex ? 'down' : 'up'
          const activeValue = active.id.toString()
          return `Sortable item "${activeValue}" is moving ${moveDirection} to position ${overIndex + 1} of ${items.length}.`
        }
        return 'Sortable item is no longer over a droppable area. Press escape to cancel.'
      },
    }),
    [items]
  )

  const screenReaderInstructions: ScreenReaderInstructions = React.useMemo(
    () => ({
      draggable: `
        To pick up a sortable item, press space or enter.
        While dragging, use the ${orientation === 'vertical' ? 'up and down' : orientation === 'horizontal' ? 'left and right' : 'arrow'} keys to move the item.
        Press space or enter again to drop the item in its new position, or press escape to cancel.
      `,
    }),
    [orientation]
  )

  const contextValue = React.useMemo(
    () => ({
      id,
      items,
      modifiers: modifiers ?? config.modifiers,
      strategy: strategy ?? config.strategy,
      activeId,
      setActiveId,
      getItemValue,
      flatCursor,
    }),
    [
      id,
      items,
      modifiers,
      strategy,
      config.modifiers,
      config.strategy,
      activeId,
      getItemValue,
      flatCursor,
    ]
  )

  return (
    <SortableRootContext.Provider value={contextValue as SortableRootContextValue<unknown>}>
      <DndContext
        collisionDetection={collisionDetection ?? config.collisionDetection}
        modifiers={modifiers ?? config.modifiers}
        sensors={sensors}
        {...sortableProps}
        id={id}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions,
          ...accessibility,
        }}
      />
    </SortableRootContext.Provider>
  )
}

const SortableContentContext = React.createContext<boolean>(false)

interface SortableContentProps extends React.ComponentProps<'div'> {
  strategy?: SortableContextProps['strategy']
  children: React.ReactNode
  withoutSlot?: boolean
}

function SortableContent(props: SortableContentProps) {
  const { strategy: strategyProp, withoutSlot, children, ref, ...contentProps } = props

  const context = useSortableContext(CONTENT_NAME)

  return (
    <SortableContentContext.Provider value={true}>
      <SortableContext items={context.items} strategy={strategyProp ?? context.strategy}>
        {withoutSlot ? (
          children
        ) : (
          <div data-slot='sortable-content' {...contentProps} ref={ref}>
            {children}
          </div>
        )}
      </SortableContext>
    </SortableContentContext.Provider>
  )
}

interface SortableItemProps extends useRender.ComponentProps<'div'> {
  value: UniqueIdentifier
  asHandle?: boolean
  disabled?: boolean
}

function SortableItem(props: SortableItemProps) {
  const { value, style, asHandle, render, disabled, className, ref, ...itemProps } = props

  const inSortableContent = React.useContext(SortableContentContext)
  const inSortableOverlay = React.useContext(SortableOverlayContext)

  if (!inSortableContent && !inSortableOverlay) {
    throw new Error(
      `\`${ITEM_NAME}\` must be used within \`${CONTENT_NAME}\` or \`${OVERLAY_NAME}\``
    )
  }

  if (value === '') {
    throw new Error(`\`${ITEM_NAME}\` value cannot be an empty string`)
  }

  const context = useSortableContext(ITEM_NAME)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: value, disabled })

  const itemRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (disabled) return
      setNodeRef(node)
      if (asHandle) setActivatorNodeRef(node)
    },
    [asHandle, disabled, setActivatorNodeRef, setNodeRef]
  )

  const composedRef = useComposedRefs(ref, itemRef)

  const composedStyle = React.useMemo<React.CSSProperties>(() => {
    return {
      transform: CSS.Translate.toString(transform),
      transition,
      ...style,
    }
  }, [transform, transition, style])

  return useRender({
    defaultTagName: 'div',
    render,
    ref: composedRef,
    props: mergeProps(
      {
        'data-disabled': disabled,
        'data-dragging': isDragging ? '' : undefined,
        'data-slot': 'sortable-item',
        style: composedStyle,
        className: cn(
          'focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
          {
            'touch-none select-none': asHandle,
            'cursor-default': context.flatCursor,
            'data-[dragging]:cursor-grabbing': !context.flatCursor,
            'cursor-grab': !isDragging && asHandle && !context.flatCursor,
            'opacity-50': isDragging,
            'pointer-events-none opacity-50': disabled,
          },
          className
        ),
      },
      itemProps,
      asHandle && !disabled ? attributes : {},
      asHandle && !disabled ? listeners : {}
    ),
    state: {
      disabled,
      dragging: isDragging,
    },
  })
}

const SortableOverlayContext = React.createContext(false)

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4',
      },
    },
  }),
}

interface SortableOverlayProps extends Omit<React.ComponentProps<typeof DragOverlay>, 'children'> {
  container?: Element | DocumentFragment | null
  children?: ((params: { value: UniqueIdentifier }) => React.ReactNode) | React.ReactNode
}

function SortableOverlay(props: SortableOverlayProps) {
  const { container: containerProp, children, ...overlayProps } = props

  const context = useSortableContext(OVERLAY_NAME)

  const [mounted, setMounted] = React.useState(false)
  React.useLayoutEffect(() => setMounted(true), [])

  const container = containerProp ?? (mounted ? globalThis.document?.body : null)

  if (!container) return null

  return ReactDOM.createPortal(
    <DragOverlay
      dropAnimation={dropAnimation}
      modifiers={context.modifiers}
      className={cn(!context.flatCursor && 'cursor-grabbing')}
      {...overlayProps}
    >
      <SortableOverlayContext.Provider value={true}>
        {context.activeId
          ? typeof children === 'function'
            ? children({ value: context.activeId })
            : children
          : null}
      </SortableOverlayContext.Provider>
    </DragOverlay>,
    container
  )
}

export { SortableRoot as Sortable, SortableContent, SortableItem, SortableOverlay }
