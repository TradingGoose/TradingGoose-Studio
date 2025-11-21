'use client'

import { useCallback, useEffect, useRef, useState, type WheelEvent } from 'react'
import { Check, Move, Pencil, Plus, X } from 'lucide-react'
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
  SortableOverlay,
} from '@/components/ui/sortable'
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
                  className={cn(
                    'group relative inline-flex h-7 items-stretch gap-1 overflow-hidden rounded-sm bg-muted px-2 hover:bg-background hover:text-secondary-foreground',
                    layout.isActive ? 'bg-background text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <SortableItemHandle
                    className='inline-flex items-center justify-center text-muted-foreground hover:text-secondary'
                    aria-label='Drag to reorder layout'
                  >
                    <Move className='h-3.5 w-3.5' />
                  </SortableItemHandle>
                  {editingId === layout.id ? (
                    <div className='inline-flex min-w-0 flex-1 items-center px-1 pr-1'>
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
                        className='h-6 w-full rounded-sm border border-border bg-background px-2 text-sm outline-none'
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
                      className='inline-flex h-full items-center gap-2 px-1 font-medium text-sm outline-none transition-colors'
                      onClick={() => onSelect(layout.id)}
                      disabled={isBusy}
                      tabIndex={-1}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <span className='truncate pb-1 font-md text-md'>{layout.name}</span>
                    </button>
                  )}
                  {editingId === layout.id ? (
                    <button
                      type='button'
                      className='inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-secondary'
                      onClick={() => commitEdit(layout)}
                      disabled={isBusy}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Check className='h-3.5 w-3.5' />
                    </button>
                  ) : layout.isActive ? (
                    <button
                      type='button'
                      className='inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-secondary'
                      onClick={() => startEdit(layout)}
                      disabled={isBusy}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Pencil className='h-3.5 w-3.5' />
                    </button>
                  ) : (
                    <button
                      type='button'
                      className='inline-flex h-full items-center justify-center text-muted-foreground transition hover:text-destructive'
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
            <div className='inline-flex items-stretch gap-1 overflow-hidden rounded-sm border border-border bg-background py-1.5 text-foreground shadow-md'>
              <div className='inline-flex items-center justify-center pl-2 '>
                <Move className='h-3.5 w-3.5' />
              </div>
              <div className='inline-flex items-center px-1 pr-3 text-sm'>
                <span className='max-w-[140px] truncate'>{current.name}</span>
              </div>
            </div>
          )
        }}
      </SortableOverlay>
    </Sortable>
  )
}
