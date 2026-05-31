'use client'

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Braces, ChevronDown, WrapText } from 'lucide-react'
import { ListingDisplayRow } from '@/components/listing-selector/listing/row'
import {
  LISTING_IDENTITY_VALUE_TYPE,
  type ListingOption,
  toListingValueObject,
} from '@/lib/listing/identity'
import { cn, redactApiKeys } from '@/lib/utils'

export type JsonDisplayMode = 'beauty' | 'raw'
type ValueType =
  | 'null'
  | 'undefined'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | typeof LISTING_IDENTITY_VALUE_TYPE

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
  copyLabel?: string
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
  copyLabel?: string
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
  copy?: {
    showRawTitle?: string
    showBeautyTitle?: string
    disableWrapTitle?: string
    enableWrapTitle?: string
    toggleModeAriaLabel?: string
    toggleWrapAriaLabel?: string
  }
}

const BADGE_STYLES: Record<ValueType, string> = {
  string: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  number: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  boolean: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  array: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  null: 'bg-muted text-muted-foreground',
  undefined: 'bg-muted text-muted-foreground',
  object: 'bg-muted text-muted-foreground',
  [LISTING_IDENTITY_VALUE_TYPE]: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
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

const copyToClipboard = (data: unknown, redact = true) => {
  navigator.clipboard.writeText(stringifyJsonDisplay(data, redact))
}

export const RawJsonView = ({
  data,
  wrapText = true,
  redact = true,
  className,
  copyLabel = 'Copy value',
}: RawJsonViewProps) => {
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const displayText = useMemo(() => stringifyJsonDisplay(data, redact), [data, redact])

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

  return (
    <div
      onContextMenu={handleContextMenu}
      className={cn(
        'relative block w-full min-w-0 max-w-full font-[380] font-mono text-muted-foreground leading-normal [contain:inline-size]',
        className,
        wrapText ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'
      )}
    >
      <pre
        className={cn(
          'm-0 px-2 font-sm text-foreground text-sm leading-[inherit]',
          wrapText
            ? 'whitespace-pre-wrap break-words'
            : 'inline-block min-w-full whitespace-pre break-normal'
        )}
      >
        {displayText}
      </pre>
      {contextMenuPosition && (
        <div
          className='fixed z-50 min-w-[160px] rounded-md border bg-popover py-1 shadow-md'
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            className='w-full px-3 py-1.5 text-left font-[380] text-sm hover:bg-card'
            onClick={() => copyToClipboard(data, redact)}
          >
            {copyLabel}
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
  if (toListingValueObject(value)) return LISTING_IDENTITY_VALUE_TYPE
  return typeof value as ValueType
}

const readRecordText = (record: Record<string, unknown>, key: string): string => {
  const raw = record[key]
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return ''
}

function toListingDisplayOption(value: unknown): ListingOption | null {
  const listing = toListingValueObject(value)
  if (!listing) return null

  const record = value as Record<string, unknown>
  const base =
    readRecordText(record, 'base') ||
    (listing.listing_type === 'default' ? listing.listing_id : listing.base_id)
  const quote =
    readRecordText(record, 'quote') || (listing.listing_type === 'default' ? '' : listing.quote_id)

  return {
    ...listing,
    base,
    quote: quote || null,
    name: readRecordText(record, 'name') || null,
    iconUrl: readRecordText(record, 'iconUrl') || null,
    assetClass:
      readRecordText(record, 'assetClass') ||
      (listing.listing_type === 'default' ? null : listing.listing_type),
    countryCode: readRecordText(record, 'countryCode') || null,
    cityName: readRecordText(record, 'cityName') || null,
    marketCode: readRecordText(record, 'marketCode') || null,
    primaryMicCode: readRecordText(record, 'primaryMicCode') || null,
    timeZoneName: readRecordText(record, 'timeZoneName') || null,
    base_asset_class: readRecordText(record, 'base_asset_class') || null,
    quote_asset_class: readRecordText(record, 'quote_asset_class') || null,
  }
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
  if (toListingValueObject(data)) return new Set(['root.value'])
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
  const listing = toListingDisplayOption(value)

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

  const collapsedSummary = isPrimitiveValue || listing ? null : getCollapsedSummary(value)

  const badgeStyle = isError ? 'bg-red-500/15 text-red-600 dark:text-red-400' : BADGE_STYLES[type]

  return (
    <div className={cn('flex min-w-0 flex-col', !wrapText && 'w-max min-w-full')}>
      <div
        className={cn(STRUCTURED_STYLES.row, !wrapText && 'w-max min-w-full')}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className={cn(STRUCTURED_STYLES.keyName, isError && 'text-destructive')}>{name}</span>
        <span className={cn(STRUCTURED_STYLES.badge, badgeStyle)}>{type}</span>
        {listing ? (
          <ListingDisplayRow listing={listing} showSecondary className='min-w-0 flex-1' />
        ) : !isExpanded && collapsedSummary ? (
          <span className={STRUCTURED_STYLES.summary}>{collapsedSummary}</span>
        ) : null}
        <ChevronDown className={cn(STRUCTURED_STYLES.chevron, !isExpanded && '-rotate-90')} />
      </div>

      {isExpanded && (
        <div className={cn(STRUCTURED_STYLES.indent, !wrapText && 'w-max min-w-full')}>
          {isPrimitiveValue ? (
            <div
              className={cn(
                STRUCTURED_STYLES.value,
                wrapText ? 'break-words' : 'w-max min-w-full whitespace-nowrap'
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
    if (isPrimitive(displayData) || toListingValueObject(displayData)) {
      return [{ key: 'value', value: displayData, path: 'root.value' }]
    }
    return buildEntries(displayData, 'root')
  }, [displayData])

  const containerClass = cn(
    'flex w-full min-w-0 max-w-full flex-col pl-[20px] [contain:inline-size]',
    className,
    wrapText ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto'
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
  copy,
}: JsonDisplayControlsProps) {
  const resolveButtonClassName = (active: boolean) =>
    cn(
      'rounded px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50',
      active && 'text-foreground',
      typeof buttonClassName === 'function' ? buttonClassName(active) : buttonClassName
    )
  const modeTitle =
    mode === 'beauty'
      ? (copy?.showRawTitle ?? 'Show raw JSON')
      : (copy?.showBeautyTitle ?? 'Show beauty view')
  const wrapTitle = wrapText
    ? (copy?.disableWrapTitle ?? 'Disable wrapping')
    : (copy?.enableWrapTitle ?? 'Enable wrapping')

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type='button'
        className={resolveButtonClassName(mode === 'beauty')}
        onClick={() => onModeChange(mode === 'beauty' ? 'raw' : 'beauty')}
        title={modeTitle}
        aria-label={copy?.toggleModeAriaLabel ?? 'Toggle JSON display mode'}
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
        title={wrapTitle}
        aria-label={copy?.toggleWrapAriaLabel ?? 'Toggle JSON text wrapping'}
        aria-pressed={wrapText}
        disabled={disabled}
      >
        <WrapText className={cn('inline h-3.5 w-3.5', showLabels && 'mr-1')} />
        {showLabels && (wrapText ? 'Wrap' : 'Unwrap')}
      </button>
    </div>
  )
}
