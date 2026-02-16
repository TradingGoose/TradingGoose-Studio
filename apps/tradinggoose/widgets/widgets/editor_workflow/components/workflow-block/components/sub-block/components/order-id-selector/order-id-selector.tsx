'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useDebounce } from '@/hooks/use-debounce'
import { OrderIdSelectorDropdown } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/dropdown'
import { fetchOrderHistorySearchOptions } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/fetchers'
import { OrderIdRow } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/order-row'
import {
  isOrderUuid,
  type OrderHistorySearchOption,
} from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface OrderIdSelectorInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: string | null
  value?: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
  config?: SubBlockConfig
}

const normalizeTextValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

const equalsIgnoreCase = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

export function OrderIdSelectorInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  value,
  onChange,
  disabled = false,
  config,
}: OrderIdSelectorInputProps) {
  const workflowId = useWorkflowId()
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlockId)

  const normalizedPreviewValue = previewValue ?? null
  const normalizedPropValue = value ?? null
  const hasPropValue = value !== undefined
  const currentRawValue = isPreview
    ? normalizedPreviewValue
    : hasPropValue
      ? normalizedPropValue
      : storeValue
  const currentValue = normalizeTextValue(currentRawValue)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(currentValue)
  const [results, setResults] = useState<OrderHistorySearchOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [selectedOrder, setSelectedOrder] = useState<OrderHistorySearchOption | null>(null)

  const instanceId = useMemo(() => `${blockId}-${subBlockId}`, [blockId, subBlockId])
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestKeyRef = useRef<string>('')

  const debouncedQuery = useDebounce(query, 300)

  const setOrderIdValue = useCallback(
    (nextValue: string | null) => {
      if (isPreview || disabled) return

      if (onChange) {
        onChange(nextValue)
        return
      }

      setStoreValue(nextValue)
    },
    [isPreview, disabled, onChange, setStoreValue]
  )

  const applySelection = useCallback(
    (order: OrderHistorySearchOption) => {
      setSelectedOrder(order)
      setQuery(order.id)
      setOpen(false)
      setHighlightedIndex(-1)
      setError(undefined)
      setOrderIdValue(order.id)
    },
    [setOrderIdValue]
  )

  useEffect(() => {
    if (open) return

    setQuery((previous) => (previous === currentValue ? previous : currentValue))

    if (!currentValue.trim()) {
      setSelectedOrder(null)
      return
    }

    if (selectedOrder && equalsIgnoreCase(selectedOrder.id, currentValue.trim())) {
      return
    }

    if (!isOrderUuid(currentValue.trim())) {
      setSelectedOrder(null)
    }
  }, [currentValue, open, selectedOrder])

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    const shouldFetch = open || isOrderUuid(trimmed)

    if (!shouldFetch) {
      if (!open && !trimmed) {
        setResults([])
        setIsLoading(false)
        setError(undefined)
      }
      return
    }

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    const requestQuery =
      open && selectedOrder && equalsIgnoreCase(trimmed, selectedOrder.id) ? '' : trimmed
    const requestKey = `${workflowId ?? ''}|${requestQuery}|${open ? 'open' : 'closed'}`
    requestKeyRef.current = requestKey

    setIsLoading(true)
    setError(undefined)

    fetchOrderHistorySearchOptions(
      {
        query: requestQuery,
        workflowId,
        limit: 20,
      },
      controller.signal
    )
      .then((rows) => {
        if (controller.signal.aborted || requestKeyRef.current !== requestKey) return

        setResults(rows)
        setIsLoading(false)
        setError(undefined)

        if (requestQuery && isOrderUuid(requestQuery)) {
          const match = rows.find((row) => equalsIgnoreCase(row.id, requestQuery))
          if (!match) {
            if (!open) {
              setSelectedOrder(null)
            }
            return
          }

          setSelectedOrder(match)
          setQuery(match.id)
          if (!equalsIgnoreCase(currentValue.trim(), match.id)) {
            setOrderIdValue(match.id)
          }
        }
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return

        setIsLoading(false)
        setError(requestError instanceof Error ? requestError.message : 'Search failed')
      })

    return () => {
      controller.abort()
    }
  }, [currentValue, debouncedQuery, open, selectedOrder, setOrderIdValue, workflowId])

  useEffect(() => {
    setHighlightedIndex((previous) => {
      if (previous >= 0 && previous < results.length) {
        return previous
      }
      return -1
    })
  }, [results])

  const showRichOverlay = !open && Boolean(selectedOrder)
  const displayValue = open ? query : (selectedOrder?.id ?? query)

  const label = config?.title ?? 'Order ID'
  const isRequired = config?.required === true

  return (
    <div className='flex w-full flex-col gap-2'>
      <div className='space-y-1.5'>
        <div className='flex items-center font-medium text-muted-foreground text-xs'>
          {label}
          {isRequired ? <span className='ml-1 text-red-500'>*</span> : null}
        </div>

        <div className='relative w-full' data-order-id-selector data-instance-id={instanceId}>
          <div className='relative'>
            <Input
              ref={inputRef}
              value={displayValue}
              className={cn(
                'w-full pr-10',
                showRichOverlay && 'text-transparent caret-transparent placeholder:text-transparent'
              )}
              placeholder='Search order by ID, symbol, or date'
              autoComplete='off'
              disabled={disabled || isPreview}
              onChange={(event) => {
                if (disabled || isPreview) return

                const nextValue = event.target.value
                const nextTrimmed = nextValue.trim()
                setQuery(nextValue)
                setOpen(true)
                setHighlightedIndex(-1)

                if (!nextTrimmed) {
                  setSelectedOrder(null)
                  setResults([])
                  setError(undefined)
                  setOrderIdValue(null)
                  return
                }

                if (selectedOrder && !equalsIgnoreCase(selectedOrder.id, nextTrimmed)) {
                  setSelectedOrder(null)
                }

                const currentTrimmed = currentValue.trim()

                if (currentTrimmed && !equalsIgnoreCase(currentTrimmed, nextTrimmed)) {
                  setOrderIdValue(isOrderUuid(nextTrimmed) ? nextTrimmed : null)
                  return
                }

                if (!currentTrimmed && isOrderUuid(nextTrimmed)) {
                  setOrderIdValue(nextTrimmed)
                }
              }}
              onFocus={() => {
                if (disabled || isPreview) return
                setOpen(true)
                setHighlightedIndex(-1)
              }}
              onBlur={() => {
                if (disabled || isPreview) return

                setTimeout(() => {
                  const activeElement = document.activeElement
                  const selector = `[data-order-id-selector][data-instance-id="${instanceId}"]`

                  if (!activeElement || !activeElement.closest(selector)) {
                    setOpen(false)
                    setHighlightedIndex(-1)

                    if (selectedOrder) {
                      setQuery(selectedOrder.id)
                    }
                  }
                }, 150)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false)
                  setHighlightedIndex(-1)
                  return
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault()

                  if (!open) {
                    setOpen(true)
                    if (results.length > 0) {
                      setHighlightedIndex(0)
                    }
                    return
                  }

                  if (results.length > 0) {
                    setHighlightedIndex((previous) =>
                      previous < results.length - 1 ? previous + 1 : 0
                    )
                  }
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault()

                  if (open && results.length > 0) {
                    setHighlightedIndex((previous) =>
                      previous > 0 ? previous - 1 : results.length - 1
                    )
                  }
                }

                if (event.key === 'Enter' && open && highlightedIndex >= 0) {
                  event.preventDefault()
                  const selected = results[highlightedIndex]
                  if (selected) {
                    applySelection(selected)
                  }
                  return
                }

                if (event.key === 'Enter' && open && isOrderUuid(query.trim())) {
                  const match = results.find((row) => equalsIgnoreCase(row.id, query.trim()))
                  if (match) {
                    event.preventDefault()
                    applySelection(match)
                  }
                }
              }}
            />

            {showRichOverlay ? (
              <div className='pointer-events-none absolute inset-y-0 left-0 flex w-full items-center px-1'>
                <OrderIdRow order={selectedOrder} className='w-full' />
              </div>
            ) : null}

            <Button
              variant='ghost'
              size='sm'
              className='-translate-y-1/2 absolute top-1/2 right-1 z-10 h-6 w-6 bg-transparent p-0'
              disabled={disabled || isPreview}
              onMouseDown={(event) => {
                event.preventDefault()
                if (disabled || isPreview) return

                setOpen((previous) => !previous)

                if (!open) {
                  inputRef.current?.focus()
                }
              }}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 opacity-0 transition-transform',
                  open && 'rotate-180 opacity-50'
                )}
              />
            </Button>
          </div>

          <OrderIdSelectorDropdown
            visible={open}
            results={results}
            isLoading={isLoading}
            error={error}
            highlightedIndex={highlightedIndex}
            onHighlightChange={setHighlightedIndex}
            onSelect={applySelection}
          />
        </div>
      </div>
    </div>
  )
}
