'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn, redactApiKeys } from '@/lib/utils'

type ValueType = 'null' | 'undefined' | 'array' | 'string' | 'number' | 'boolean' | 'object'

interface NodeEntry {
  key: string
  value: unknown
  path: string
}

const BADGE_STYLES: Record<ValueType, string> = {
  string: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  number: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  boolean: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  array: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  null: 'bg-muted text-muted-foreground',
  undefined: 'bg-muted text-muted-foreground',
  object: 'bg-muted text-muted-foreground',
}

const STYLES = {
  row: 'group flex min-h-[22px] cursor-pointer items-center gap-[6px] rounded-[8px] px-[6px] -mx-[6px] hover:bg-muted/60',
  chevron:
    'h-[8px] w-[8px] flex-shrink-0 text-muted-foreground transition-transform duration-100 group-hover:text-foreground',
  keyName: 'font-medium text-[13px] text-foreground',
  badge: 'rounded-[4px] px-[4px] py-[0px] text-[11px]',
  summary: 'text-[12px] text-muted-foreground',
  indent: 'mt-[2px] ml-[3px] flex min-w-0 flex-col gap-[2px] border-l border-border pl-[9px]',
  value: 'min-w-0 py-[2px] text-[13px] text-foreground',
  emptyValue: 'py-[2px] text-[13px] text-muted-foreground',
} as const

function getTypeLabel(value: unknown): ValueType {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value as ValueType
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}

function isPrimitive(value: unknown): value is null | undefined | string | number | boolean {
  return value === null || value === undefined || typeof value !== 'object'
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
  return false
}

function extractErrorMessage(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof Error) return data.message
  if (typeof data === 'object' && data !== null && 'message' in data) {
    return String((data as { message: unknown }).message)
  }
  return JSON.stringify(data, null, 2)
}

function buildEntries(value: unknown, basePath: string): NodeEntry[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: String(index),
      value: item,
      path: `${basePath}[${index}]`,
    }))
  }
  return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
    key,
    value: entryValue,
    path: `${basePath}.${key}`,
  }))
}

function getCollapsedSummary(value: unknown): string | null {
  if (Array.isArray(value)) {
    const len = value.length
    return `${len} item${len !== 1 ? 's' : ''}`
  }
  if (typeof value === 'object' && value !== null) {
    const count = Object.keys(value).length
    return `${count} key${count !== 1 ? 's' : ''}`
  }
  return null
}

function computeInitialPaths(data: unknown, isError: boolean): Set<string> {
  if (isError) return new Set(['root.error'])
  if (!data || typeof data !== 'object') return new Set()
  const entries = Array.isArray(data)
    ? data.map((_, index) => `root[${index}]`)
    : Object.keys(data).map((key) => `root.${key}`)
  return new Set(entries)
}

interface StructuredNodeProps {
  name: string
  value: unknown
  path: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  wrapText: boolean
  isError?: boolean
}

const StructuredNode = memo(function StructuredNode({
  name,
  value,
  path,
  expandedPaths,
  onToggle,
  wrapText,
  isError = false,
}: StructuredNodeProps) {
  const type = getTypeLabel(value)
  const isPrimitiveValue = isPrimitive(value)
  const isEmptyValue = !isPrimitiveValue && isEmpty(value)
  const isExpanded = expandedPaths.has(path)

  const handleToggle = useCallback(() => onToggle(path), [onToggle, path])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleToggle()
      }
    },
    [handleToggle]
  )

  const childEntries = useMemo(
    () => (isPrimitiveValue || isEmptyValue ? [] : buildEntries(value, path)),
    [value, isPrimitiveValue, isEmptyValue, path]
  )

  const collapsedSummary = useMemo(
    () => (isPrimitiveValue ? null : getCollapsedSummary(value)),
    [value, isPrimitiveValue]
  )

  const badgeStyle = isError
    ? 'bg-red-500/15 text-red-600 dark:text-red-400'
    : BADGE_STYLES[type]

  return (
    <div className='flex min-w-0 flex-col'>
      <div
        className={STYLES.row}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className={cn(STYLES.keyName, isError && 'text-destructive')}>{name}</span>
        <span className={cn(STYLES.badge, badgeStyle)}>{type}</span>
        {!isExpanded && collapsedSummary && (
          <span className={STYLES.summary}>{collapsedSummary}</span>
        )}
        <ChevronDown className={cn(STYLES.chevron, !isExpanded && '-rotate-90')} />
      </div>

      {isExpanded && (
        <div className={STYLES.indent}>
          {isPrimitiveValue ? (
            <div
              className={cn(
                STYLES.value,
                wrapText ? 'break-words' : 'whitespace-nowrap'
              )}
            >
              {formatPrimitive(value)}
            </div>
          ) : isEmptyValue ? (
            <div className={STYLES.emptyValue}>{Array.isArray(value) ? '[]' : '{}'}</div>
          ) : (
            childEntries.map((entry) => (
              <StructuredNode
                key={entry.path}
                name={entry.key}
                value={entry.value}
                path={entry.path}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                wrapText={wrapText}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
})

export interface StructuredOutputProps {
  data: unknown
  wrapText?: boolean
  isError?: boolean
  isRunning?: boolean
  className?: string
}

export const StructuredOutput = memo(function StructuredOutput({
  data,
  wrapText = true,
  isError = false,
  isRunning = false,
  className,
}: StructuredOutputProps) {
  const safeData = useMemo(() => redactApiKeys(data), [data])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    computeInitialPaths(safeData, isError)
  )

  useEffect(() => {
    setExpandedPaths(computeInitialPaths(safeData, isError))
  }, [safeData, isError])

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const rootEntries = useMemo<NodeEntry[]>(() => {
    if (isPrimitive(safeData)) return [{ key: 'value', value: safeData, path: 'root.value' }]
    return buildEntries(safeData, 'root')
  }, [safeData])

  const containerClass = cn(
    'flex flex-col pl-[20px]',
    wrapText ? 'overflow-x-hidden' : 'overflow-x-auto',
    className
  )

  if (isRunning && safeData === undefined) {
    return (
      <div className={containerClass}>
        <div className={STYLES.row}>
          <span className={STYLES.keyName}>running</span>
          <span
            className={cn(
              STYLES.badge,
              'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            )}
          >
            Running
          </span>
        </div>
      </div>
    )
  }

  if (rootEntries.length === 0 && !isError) {
    return (
      <div className={containerClass}>
        <span className={STYLES.emptyValue}>null</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={containerClass}>
        <StructuredNode
          name='error'
          value={extractErrorMessage(safeData)}
          path='root.error'
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          wrapText={wrapText}
          isError
        />
      </div>
    )
  }

  return (
    <div className={containerClass}>
      {rootEntries.map((entry) => (
        <StructuredNode
          key={entry.path}
          name={entry.key}
          value={entry.value}
          path={entry.path}
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          wrapText={wrapText}
        />
      ))}
    </div>
  )
})
