'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { OrderIdRow } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/order-row'
import type { OrderHistorySearchOption } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'

type OrderIdSelectorDropdownProps = {
  visible: boolean
  results: OrderHistorySearchOption[]
  isLoading: boolean
  error?: string
  highlightedIndex: number
  onHighlightChange: (index: number) => void
  onSelect: (order: OrderHistorySearchOption) => void
}

export function OrderIdSelectorDropdown({
  visible,
  results,
  isLoading,
  error,
  highlightedIndex,
  onHighlightChange,
  onSelect,
}: OrderIdSelectorDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return

    const target = dropdownRef.current.querySelector(`[data-option-index="${highlightedIndex}"]`)
    if (target && target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  if (!visible) return null

  return (
    <div className='absolute top-full left-0 z-[100] mt-1 w-full'>
      <div className='allow-scroll fade-in-0 zoom-in-95 animate-in rounded-md border bg-popover text-popover-foreground shadow-lg'>
        <div
          ref={dropdownRef}
          className='allow-scroll max-h-64 overflow-y-auto p-1'
          style={{ scrollbarWidth: 'thin' }}
          onMouseLeave={() => onHighlightChange(-1)}
        >
          {isLoading ? (
            <div className='py-6 text-center text-muted-foreground text-sm'>Searching...</div>
          ) : results.length === 0 ? (
            <div className='py-6 text-center text-muted-foreground text-sm'>
              {error || 'No orders found.'}
            </div>
          ) : (
            results.map((order, index) => {
              const isHighlighted = index === highlightedIndex

              return (
                <div
                  key={order.id}
                  data-option-index={index}
                  onMouseEnter={() => onHighlightChange(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onSelect(order)
                  }}
                  className={cn(
                    'flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                    isHighlighted && 'bg-accent text-accent-foreground'
                  )}
                >
                  <OrderIdRow order={order} className='w-full' />
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
