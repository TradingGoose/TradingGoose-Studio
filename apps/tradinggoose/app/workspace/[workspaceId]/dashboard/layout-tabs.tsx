'use client'

import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react'
import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Check, Pencil, Plus, X } from 'lucide-react'
import { Sortable, SortableContent, SortableItem, SortableOverlay } from '@/components/ui/sortable'
import { cn } from '@/lib/utils'

export type LayoutTab = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

interface LayoutTabsProps {
  layouts: LayoutTab[]
  isBusy?: boolean
  onSelect: (layoutId: string) => void
  onReorder: (nextLayouts: LayoutTab[]) => void
  onCreate: () => void
  onRename: (layoutId: string, name: string) => void
  onDelete: (layoutId: string) => void
}

export function LayoutTabs({
  layouts,
  isBusy = false,
  onSelect,
  onReorder,
  onCreate,
  onRename,
  onDelete,
}: LayoutTabsProps) {
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const handleValueChange = (items: LayoutTab[]) => {
    const ordered = items.map((item, index) => ({
      ...item,
      sortOrder: index,
    }))
    onReorder(ordered)
  }
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleHorizontalWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!tabsScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    tabsScrollRef.current.scrollLeft += event.deltaY
  }, [])

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startEdit = (layout: LayoutTab) => {
    setEditingId(layout.id)
    setEditValue(layout.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const commitEdit = (layout: LayoutTab) => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === layout.name) {
      cancelEdit()
      return
    }
    onRename(layout.id, trimmed)
    cancelEdit()
  }

  return (
    <Sortable
      orientation='horizontal'
      value={layouts}
      getItemValue={(item) => item.id}
      onValueChange={handleValueChange}
      sensors={sensors}
      flatCursor
    >
      <div className='flex min-w-0 items-center gap-2'>
        <div className='flex min-w-0 flex-1 items-center gap-2 rounded-md bg-muted px-1 py-1'>
          <div
            ref={tabsScrollRef}
            onWheel={handleHorizontalWheel}
            className='flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            <SortableContent className='flex items-center gap-2'>
              {layouts.map((layout) => (
                <SortableItem
                  key={layout.id}
                  value={layout.id}
                  asHandle
                  className={cn(
                    'group relative inline-flex h-7 min-w-0 max-w-[200px] items-stretch gap-1 overflow-hidden rounded-sm bg-muted px-2 hover:bg-background hover:text-secondary-foreground',
                    layout.isActive ? 'bg-background text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {editingId === layout.id ? (
                    <div className='inline-flex min-w-0 flex-1 items-center'>
                      <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(layout)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitEdit(layout)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEdit()
                          }
                        }}
                        className='h-6 w-full rounded-sm border border-border bg-muted/40 px-2 text-sm outline-none'
                        disabled={isBusy}
                        onPointerDownCapture={(event) => event.stopPropagation()}
                        autoComplete='off'
                        autoCorrect='off'
                        autoCapitalize='off'
                        spellCheck='false'
                      />
                    </div>
                  ) : (
                    <button
                      type='button'
                      className='inline-flex h-full min-w-0 flex-1 items-center px-1 font-medium text-sm outline-none transition-colors'
                      onClick={() => onSelect(layout.id)}
                      disabled={isBusy}
                      tabIndex={-1}
                    >
                      <span className='min-w-0 flex-1 truncate pr-1 pb-1 font-md text-md'>
                        {layout.name}
                      </span>
                    </button>
                  )}
                  {editingId === layout.id ? (
                    <button
                      type='button'
                      className='inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-foreground'
                      onClick={() => commitEdit(layout)}
                      disabled={isBusy}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Check className='h-3.5 w-3.5' />
                    </button>
                  ) : layout.isActive ? (
                    <button
                      type='button'
                      className='pointer-events-none inline-flex h-full w-0 shrink-0 items-center justify-center overflow-hidden text-muted-foreground opacity-0 transition-[width,opacity,color] hover:text-foreground focus-visible:pointer-events-auto focus-visible:w-4 focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:w-4 group-hover:opacity-100'
                      onClick={() => startEdit(layout)}
                      disabled={isBusy}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Pencil className='h-3.5 w-3.5' />
                    </button>
                  ) : (
                    <button
                      type='button'
                      className='pointer-events-none inline-flex h-full w-0 shrink-0 items-center justify-center overflow-hidden text-muted-foreground opacity-0 transition-[width,opacity,color] hover:text-destructive focus-visible:pointer-events-auto focus-visible:w-4 focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:w-4 group-hover:opacity-100'
                      onClick={() => onDelete(layout.id)}
                      disabled={isBusy}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <X className='h-4 w-4' />
                    </button>
                  )}
                </SortableItem>
              ))}
            </SortableContent>
          </div>
        </div>
        <button
          type='button'
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            isBusy ? 'cursor-progress' : 'cursor-pointer'
          )}
          onClick={onCreate}
          disabled={isBusy}
        >
          <Plus className='h-3.5 w-3.5' />
          <span className='sr-only'>Create new layout</span>
        </button>
      </div>
      <SortableOverlay>
        {({ value }) => {
          const current = layouts.find((layout) => layout.id === value)
          if (!current) return null

          return (
            <div className='inline-flex items-center overflow-hidden rounded-sm border border-border bg-background px-3 py-1.5 text-foreground text-sm shadow-md'>
              <div className='inline-flex items-center'>
                <span className='max-w-[140px] truncate'>{current.name}</span>
              </div>
            </div>
          )
        }}
      </SortableOverlay>
    </Sortable>
  )
}
