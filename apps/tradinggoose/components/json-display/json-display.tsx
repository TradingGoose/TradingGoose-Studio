'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Braces, ChevronDown, WrapText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, redactApiKeys } from '@/lib/utils'

export type JsonDisplayMode = 'beauty' | 'raw'
type ValueType = 'null' | 'undefined' | 'array' | 'string' | 'number' | 'boolean' | 'object'

interface NodeEntry {
  key: string
  value: unknown
  path: string
}

export interface RawJsonViewProps {
  data: unknown
  wrapText?: boolean
  redact?: boolean
  className?: string
}

export interface StructuredJsonViewProps {
  data: unknown
  wrapText?: boolean
  isError?: boolean
  isRunning?: boolean
  redact?: boolean
  className?: string
}

export interface JsonDisplayProps extends StructuredJsonViewProps {
  mode?: JsonDisplayMode
}

export interface JsonDisplayControlsProps {
  mode: JsonDisplayMode
  onModeChange: (mode: JsonDisplayMode) => void
  wrapText: boolean
  onWrapTextChange: (wrapText: boolean) => void
  showLabels?: boolean
  disabled?: boolean
  className?: string
  buttonClassName?: string | ((active: boolean) => string)
}

const MAX_STRING_LENGTH = 150
const MAX_OBJECT_KEYS = 10
const MAX_ARRAY_ITEMS = 20

const BADGE_STYLES: Record<ValueType, string> = {
  string: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  number: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  boolean: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  array: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  null: 'bg-muted text-muted-foreground',
  undefined: 'bg-muted text-muted-foreground',
  object: 'bg-muted text-muted-foreground',
}

const STRUCTURED_STYLES = {
  row: 'group flex min-h-[22px] cursor-pointer items-center gap-[6px] rounded-md px-[6px] -mx-[6px] hover:bg-muted/60',
  chevron:
    'h-[8px] w-[8px] flex-shrink-0 text-muted-foreground transition-transform duration-100 group-hover:text-foreground',
  keyName: 'font-medium text-[13px] text-foreground',
  badge: 'rounded-sm px-[4px] py-[0px] text-[11px]',
  summary: 'text-[12px] text-muted-foreground',
  indent: 'mt-[2px] ml-[3px] flex min-w-0 flex-col gap-[2px] border-l border-border pl-[9px]',
  value: 'min-w-0 py-[2px] text-[13px] text-foreground',
  emptyValue: 'py-[2px] text-[13px] text-muted-foreground',
} as const

const getDisplayData = (data: unknown, redact: boolean) => (redact ? redactApiKeys(data) : data)

export function stringifyJsonDisplay(data: unknown, redact = true): string {
  const displayData = getDisplayData(data, redact)
  if (displayData === undefined) return 'undefined'

  try {
    return JSON.stringify(displayData, null, 2) ?? String(displayData)
  } catch (_error) {
    return String(displayData)
  }
}

const TruncatedValue = ({ value }: { value: string }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (value.length <= MAX_STRING_LENGTH) {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>{value}</span>
    )
  }

  return (
    <span className='break-all font-[380] text-muted-foreground leading-normal'>
      {isExpanded ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`}
      <Button
        variant='link'
        size='sm'
        className='h-auto px-1 font-[380] text-muted-foreground/70 text-xs hover:text-foreground'
        onClick={(event) => {
          event.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
      >
        {isExpanded ? 'Show less' : 'Show more'}
      </Button>
    </span>
  )
}

const CollapsibleJSON = ({ data, depth = 0 }: { data: unknown; depth?: number }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (data === null) {
    return <span className='break-all font-[380] text-muted-foreground leading-normal'>null</span>
  }

  if (data === undefined) {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>undefined</span>
    )
  }

  if (typeof data === 'string') {
    return <TruncatedValue value={JSON.stringify(data)} />
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return (
      <span className='break-all font-[380] text-muted-foreground leading-normal'>
        {JSON.stringify(data)}
      </span>
    )
  }

  if (Array.isArray(data)) {
    const shouldCollapse = depth > 0 && data.length > MAX_ARRAY_ITEMS

    if (shouldCollapse && !isExpanded) {
      return (
        <span
          className='cursor-pointer break-all font-[380] text-muted-foreground/70 text-xs leading-normal'
          onClick={() => setIsExpanded(true)}
        >
          {'[...]'}
        </span>
      )
    }

    return (
      <span className='break-all font-[380] text-muted-foreground/70 leading-normal'>
        {'['}
        {data.length > 0 && (
          <>
            {'\n'}
            {data.map((item, index) => (
              <span key={index} className='break-all'>
                {'  '.repeat(depth + 1)}
                <CollapsibleJSON data={item} depth={depth + 1} />
                {index < data.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {'  '.repeat(depth)}
          </>
        )}
        {']'}
      </span>
    )
  }

  if (typeof data === 'object') {
    const record = data as Record<string, unknown>
    const keys = Object.keys(record)
    const shouldCollapse = depth > 0 && keys.length > MAX_OBJECT_KEYS

    if (shouldCollapse && !isExpanded) {
      return (
        <span
          className='cursor-pointer break-all font-[380] text-muted-foreground/70 text-xs leading-normal'
          onClick={() => setIsExpanded(true)}
        >
          {'{...}'}
        </span>
      )
    }

    return (
      <span className='break-all font-[380] text-muted-foreground/70 leading-normal'>
        {'{'}
        {keys.length > 0 && (
          <>
            {'\n'}
            {keys.map((key, index) => (
              <span key={key} className='break-all'>
                {'  '.repeat(depth + 1)}
                <span className='break-all font-[380] text-foreground leading-normal'>{key}</span>
                <span className='font-[380] text-muted-foreground/60 leading-normal'>: </span>
                <CollapsibleJSON data={record[key]} depth={depth + 1} />
                {index < keys.length - 1 ? ',' : ''}
                {'\n'}
              </span>
            ))}
            {'  '.repeat(depth)}
          </>
        )}
        {'}'}
      </span>
    )
  }

  return (
    <span className='break-all font-[380] text-muted-foreground leading-normal'>
      {JSON.stringify(data)}
    </span>
  )
}

const copyToClipboard = (data: unknown, redact = true) => {
  navigator.clipboard.writeText(stringifyJsonDisplay(data, redact))
}

export const RawJsonView = ({
  data,
  wrapText = true,
  redact = true,
  className,
}: RawJsonViewProps) => {
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const displayData = useMemo(() => getDisplayData(data, redact), [data, redact])

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    const handleClickOutside = () => setContextMenuPosition(null)
    if (contextMenuPosition) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenuPosition])

  if (displayData === null) {
    return <span className='font-[380] text-muted-foreground leading-normal'>null</span>
  }

  if (typeof displayData !== 'object') {
    const stringValue =
      displayData === undefined ? 'undefined' : (JSON.stringify(displayData) ?? String(displayData))
    return (
      <span
        onContextMenu={handleContextMenu}
        className={cn(
          'relative max-w-full font-[380] font-mono text-muted-foreground leading-normal',
          wrapText ? 'overflow-hidden break-all' : 'overflow-x-auto whitespace-pre',
          className
        )}
      >
        {typeof displayData === 'string' ? (
          <TruncatedValue value={stringValue} />
        ) : (
          <span className='break-all font-[380] text-muted-foreground leading-normal'>
            {stringValue}
          </span>
        )}
        {contextMenuPosition && (
          <div
            className='fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md'
            style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
          >
            <button
              className='w-full px-3 py-1.5 text-left font-[380] text-sm hover:bg-card'
              onClick={() => copyToClipboard(displayData, redact)}
            >
              Copy value
            </button>
          </div>
        )}
      </span>
    )
  }

  return (
    <div onContextMenu={handleContextMenu} className={className}>
      <pre
        className={cn(
          'max-w-full px-2 font-mono',
          wrapText
            ? 'overflow-hidden whitespace-pre-wrap break-all'
            : 'overflow-x-auto whitespace-pre'
        )}
      >
        <CollapsibleJSON data={displayData} />
      </pre>
      {contextMenuPosition && (
        <div
          className='fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md'
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            className='w-full px-3 py-1.5 text-left font-[380] text-sm hover:bg-card'
            onClick={() => copyToClipboard(displayData, redact)}
          >
            Copy object
          </button>
        </div>
      )}
    </div>
  )
}

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
  return stringifyJsonDisplay(data, false)
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

  const badgeStyle = isError ? 'bg-red-500/15 text-red-600 dark:text-red-400' : BADGE_STYLES[type]

  return (
    <div className='flex min-w-0 flex-col'>
      <div
        className={STRUCTURED_STYLES.row}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className={cn(STRUCTURED_STYLES.keyName, isError && 'text-destructive')}>{name}</span>
        <span className={cn(STRUCTURED_STYLES.badge, badgeStyle)}>{type}</span>
        {!isExpanded && collapsedSummary && (
          <span className={STRUCTURED_STYLES.summary}>{collapsedSummary}</span>
        )}
        <ChevronDown className={cn(STRUCTURED_STYLES.chevron, !isExpanded && '-rotate-90')} />
      </div>

      {isExpanded && (
        <div className={STRUCTURED_STYLES.indent}>
          {isPrimitiveValue ? (
            <div
              className={cn(
                STRUCTURED_STYLES.value,
                wrapText ? 'break-words' : 'whitespace-nowrap'
              )}
            >
              {formatPrimitive(value)}
            </div>
          ) : isEmptyValue ? (
            <div className={STRUCTURED_STYLES.emptyValue}>{Array.isArray(value) ? '[]' : '{}'}</div>
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

export const StructuredJsonView = memo(function StructuredJsonView({
  data,
  wrapText = true,
  isError = false,
  isRunning = false,
  redact = true,
  className,
}: StructuredJsonViewProps) {
  const displayData = useMemo(() => getDisplayData(data, redact), [data, redact])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    computeInitialPaths(displayData, isError)
  )

  useEffect(() => {
    setExpandedPaths(computeInitialPaths(displayData, isError))
  }, [displayData, isError])

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
    if (isPrimitive(displayData)) {
      return [{ key: 'value', value: displayData, path: 'root.value' }]
    }
    return buildEntries(displayData, 'root')
  }, [displayData])

  const containerClass = cn(
    'flex flex-col pl-[20px]',
    wrapText ? 'overflow-x-hidden' : 'overflow-x-auto',
    className
  )

  if (isRunning && displayData === undefined) {
    return (
      <div className={containerClass}>
        <div className={STRUCTURED_STYLES.row}>
          <span className={STRUCTURED_STYLES.keyName}>running</span>
          <span
            className={cn(
              STRUCTURED_STYLES.badge,
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
        <span className={STRUCTURED_STYLES.emptyValue}>null</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={containerClass}>
        <StructuredNode
          name='error'
          value={extractErrorMessage(displayData)}
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

export function JsonDisplay({ mode = 'raw', ...props }: JsonDisplayProps) {
  if (mode === 'beauty') {
    return <StructuredJsonView {...props} />
  }

  return <RawJsonView {...props} />
}

export function JsonDisplayControls({
  mode,
  onModeChange,
  wrapText,
  onWrapTextChange,
  showLabels = true,
  disabled = false,
  className,
  buttonClassName,
}: JsonDisplayControlsProps) {
  const resolveButtonClassName = (active: boolean) =>
    cn(
      'rounded px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50',
      active && 'text-foreground',
      typeof buttonClassName === 'function' ? buttonClassName(active) : buttonClassName
    )

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type='button'
        className={resolveButtonClassName(mode === 'beauty')}
        onClick={() => onModeChange(mode === 'beauty' ? 'raw' : 'beauty')}
        title={mode === 'beauty' ? 'Show raw JSON' : 'Show beauty view'}
        aria-label='Toggle JSON display mode'
        aria-pressed={mode === 'beauty'}
        disabled={disabled}
      >
        <Braces className={cn('inline h-3.5 w-3.5', showLabels && 'mr-1')} />
        {showLabels && (mode === 'beauty' ? 'Beauty' : 'Raw')}
      </button>
      <button
        type='button'
        className={resolveButtonClassName(wrapText)}
        onClick={() => onWrapTextChange(!wrapText)}
        title={wrapText ? 'Disable wrapping' : 'Enable wrapping'}
        aria-label='Toggle JSON text wrapping'
        aria-pressed={wrapText}
        disabled={disabled}
      >
        <WrapText className={cn('inline h-3.5 w-3.5', showLabels && 'mr-1')} />
        {showLabels && (wrapText ? 'Wrap' : 'Unwrap')}
      </button>
    </div>
  )
}
