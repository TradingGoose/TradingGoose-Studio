'use client'

import type * as React from 'react'

// ── Types ─────────────────────────────────────────────────────────

/** Serializable subset of SubBlockConfig for documentation rendering */
export interface DocSubBlock {
  id: string
  title?: string
  type:
    | 'short-input'
    | 'long-input'
    | 'dropdown'
    | 'switch'
    | 'code'
    | 'slider'
    | 'oauth-input'
    | 'file-upload'
    | 'text'
    | 'table'
    | 'checkbox-list'
    | 'combobox'
    | 'time-input'
    | 'datetime-input'
    | 'market-selector'
    | 'channel-selector'
    | string
  layout?: 'full' | 'half'
  placeholder?: string
  description?: string
  defaultValue?: string | number | boolean
  options?: Array<{ label: string; id: string }>
  required?: boolean
  password?: boolean
  min?: number
  max?: number
  step?: number
  language?: string
  provider?: string
}

export interface DocOutput {
  key: string
  type: string
  description?: string
}

interface BlockConfigPreviewProps {
  /** Block display name */
  name: string
  /** Block type identifier */
  type: string
  /** Background color (hex) */
  color?: string
  /** Inline SVG string for icon */
  iconSvg?: string
  /** Configuration fields */
  subBlocks: DocSubBlock[]
  /** Output fields */
  outputs?: DocOutput[]
  /** Tools this block accesses */
  tools?: string[]
  /** Whether to show in compact mode */
  compact?: boolean
  /** Hide the icon+name header (use when BlockInfoCard is shown above) */
  hideHeader?: boolean
}

// ── Sub-components ────────────────────────────────────────────────

function FieldLabel({ title, required }: { title: string; required?: boolean }) {
  return (
    <div className='mb-1 flex items-center gap-1 text-xs font-medium text-fd-foreground/70'>
      {title}
      {required && <span className='text-red-500'>*</span>}
    </div>
  )
}

function ShortInput({ field }: { field: DocSubBlock }) {
  return (
    <div className='flex h-8 items-center rounded-md border border-fd-border bg-fd-background px-3 text-xs text-fd-muted-foreground'>
      {field.password ? '••••••••' : (field.placeholder || field.defaultValue || `Enter ${field.title?.toLowerCase() || 'value'}...`)}
    </div>
  )
}

function LongInput({ field }: { field: DocSubBlock }) {
  return (
    <div className='flex min-h-[60px] items-start rounded-md border border-fd-border bg-fd-background p-2 text-xs text-fd-muted-foreground'>
      {field.placeholder || field.defaultValue || `Enter ${field.title?.toLowerCase() || 'text'}...`}
    </div>
  )
}

function Dropdown({ field }: { field: DocSubBlock }) {
  const selected = field.options?.find((o) => o.id === String(field.defaultValue))
  return (
    <div className='flex h-8 items-center justify-between rounded-md border border-fd-border bg-fd-background px-3 text-xs'>
      <span className={selected ? 'text-fd-foreground' : 'text-fd-muted-foreground'}>
        {selected?.label || field.placeholder || 'Select...'}
      </span>
      <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' className='text-fd-muted-foreground'>
        <path d='M6 9l6 6 6-6' />
      </svg>
    </div>
  )
}

function Switch({ field }: { field: DocSubBlock }) {
  const on = field.defaultValue === true
  return (
    <div className='flex items-center gap-2'>
      <div
        className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-blue-500' : 'bg-fd-border'}`}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </div>
      <span className='text-xs text-fd-muted-foreground'>
        {on ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  )
}

function CodeEditor({ field }: { field: DocSubBlock }) {
  return (
    <div className='overflow-hidden rounded-md border border-fd-border'>
      <div className='flex items-center justify-between border-b border-fd-border bg-fd-muted/50 px-3 py-1'>
        <span className='text-[10px] font-medium text-fd-muted-foreground'>
          {field.language || 'code'}
        </span>
      </div>
      <div className='bg-fd-background p-3 font-mono text-xs text-fd-muted-foreground'>
        {field.defaultValue || field.placeholder || '// Your code here...'}
      </div>
    </div>
  )
}

function Slider({ field }: { field: DocSubBlock }) {
  const val = typeof field.defaultValue === 'number' ? field.defaultValue : field.min || 0
  const min = field.min ?? 0
  const max = field.max ?? 100
  const pct = ((val - min) / (max - min)) * 100
  return (
    <div className='flex items-center gap-3'>
      <div className='relative h-1.5 flex-1 rounded-full bg-fd-border'>
        <div
          className='absolute left-0 top-0 h-full rounded-full bg-blue-500'
          style={{ width: `${pct}%` }}
        />
        <div
          className='absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-blue-500 bg-white'
          style={{ left: `${pct}%`, marginLeft: '-7px' }}
        />
      </div>
      <span className='min-w-[2rem] text-right text-xs text-fd-muted-foreground'>{val}</span>
    </div>
  )
}

function OAuthInput({ field }: { field: DocSubBlock }) {
  return (
    <div className='flex h-8 items-center gap-2 rounded-md border border-fd-border bg-fd-background px-3 text-xs text-fd-muted-foreground'>
      <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
        <path d='M7 11V7a5 5 0 0 1 10 0v4' />
      </svg>
      {field.placeholder || `Connect ${field.provider || 'account'}...`}
    </div>
  )
}

function MarketSelector({ field }: { field: DocSubBlock }) {
  return (
    <div className='flex h-8 items-center gap-2 rounded-md border border-fd-border bg-fd-background px-3 text-xs text-fd-muted-foreground'>
      <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <polyline points='22 7 13.5 15.5 8.5 10.5 2 17' />
        <polyline points='16 7 22 7 22 13' />
      </svg>
      {field.placeholder || 'Select market...'}
    </div>
  )
}

function GenericField({ field }: { field: DocSubBlock }) {
  return (
    <div className='flex h-8 items-center rounded-md border border-fd-border bg-fd-background px-3 text-xs text-fd-muted-foreground'>
      {field.placeholder || field.title || field.type}
    </div>
  )
}

function renderField(field: DocSubBlock) {
  switch (field.type) {
    case 'short-input':
      return <ShortInput field={field} />
    case 'long-input':
      return <LongInput field={field} />
    case 'dropdown':
    case 'combobox':
      return <Dropdown field={field} />
    case 'switch':
      return <Switch field={field} />
    case 'code':
      return <CodeEditor field={field} />
    case 'slider':
      return <Slider field={field} />
    case 'oauth-input':
      return <OAuthInput field={field} />
    case 'market-selector':
      return <MarketSelector field={field} />
    default:
      return <GenericField field={field} />
  }
}

// ── Main Component ────────────────────────────────────────────────

export function BlockConfigPreview({
  name,
  type,
  color = '#F5F5F5',
  iconSvg,
  subBlocks,
  outputs,
  tools,
  compact,
  hideHeader,
}: BlockConfigPreviewProps): React.ReactNode {
  // Group fields into rows (half-width fields pair up)
  const rows: DocSubBlock[][] = []
  let pendingHalf: DocSubBlock | null = null

  for (const field of subBlocks) {
    if (field.type === 'text' && !field.defaultValue) continue
    if (field.layout === 'half') {
      if (pendingHalf) {
        rows.push([pendingHalf, field])
        pendingHalf = null
      } else {
        pendingHalf = field
      }
    } else {
      if (pendingHalf) {
        rows.push([pendingHalf])
        pendingHalf = null
      }
      rows.push([field])
    }
  }
  if (pendingHalf) rows.push([pendingHalf])

  const bgColor = color && color.length > 1 ? color : undefined

  return (
    <div className='w-full overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm sm:max-w-md'>
      {/* Header — hidden when BlockInfoCard is shown above */}
      {!hideHeader && (
        <div className='flex items-center gap-3 border-b border-fd-border bg-fd-muted/30 px-4 py-3'>
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-md ${!bgColor ? 'bg-fd-secondary' : ''}`}
            style={bgColor ? { backgroundColor: bgColor } : undefined}
          >
            {iconSvg ? (
              <div
                className={`h-4 w-4 ${bgColor ? 'text-white' : 'text-fd-foreground'}`}
                dangerouslySetInnerHTML={{ __html: iconSvg }}
              />
            ) : (
              <span className='text-sm font-bold text-fd-muted-foreground'>
                {type.substring(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <div className='text-sm font-semibold text-fd-foreground'>{name}</div>
            <div className='text-[10px] text-fd-muted-foreground'>{type}</div>
          </div>
        </div>
      )}

      {/* Fields */}
      <div className='space-y-3 p-4'>
        {rows.map((row, i) => (
          <div key={i} className={`gap-3 ${row.length > 1 ? 'grid grid-cols-2' : ''}`}>
            {row.map((field) => (
              <div key={field.id}>
                {field.title && <FieldLabel title={field.title} required={field.required} />}
                {renderField(field)}
                {field.description && (
                  <div className='mt-0.5 text-[10px] text-fd-muted-foreground'>
                    {field.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Trigger Deploy Preview ────────────────────────────────────────

interface TriggerDeployPreviewProps {
  /** Trigger display name */
  name: string
  /** Fields shown in the deploy modal */
  fields: Array<{
    id: string
    title: string
    type: 'text' | 'dropdown' | 'input' | 'webhook-url' | 'toggle'
    value?: string
    placeholder?: string
    options?: Array<{ label: string; id: string }>
    readOnly?: boolean
  }>
  /** Active/inactive state */
  active?: boolean
}

export function TriggerDeployPreview({
  name,
  fields,
  active = false,
}: TriggerDeployPreviewProps): React.ReactNode {
  return (
    <div className='my-4 w-full overflow-hidden rounded-lg border border-fd-border sm:max-w-md'>
      {/* Modal Header */}
      <div className='flex items-center justify-between border-b border-fd-border bg-fd-muted/30 px-4 py-3'>
        <div className='text-sm font-semibold text-fd-foreground'>Deploy: {name}</div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? 'bg-green-500/10 text-green-600' : 'bg-fd-muted text-fd-muted-foreground'}`}
        >
          {active ? 'Active' : 'Inactive'}
        </div>
      </div>

      {/* Fields */}
      <div className='space-y-3 p-4'>
        {fields.map((field) => (
          <div key={field.id}>
            <div className='mb-1 text-xs font-medium text-fd-foreground/70'>{field.title}</div>
            {field.type === 'webhook-url' ? (
              <div className='flex h-8 items-center justify-between rounded-md border border-fd-border bg-fd-muted/50 px-3'>
                <span className='truncate font-mono text-[10px] text-fd-muted-foreground'>
                  {field.value || 'https://app.tradinggoose.com/api/webhooks/...'}
                </span>
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  className='ml-2 shrink-0 text-fd-muted-foreground'
                >
                  <rect x='9' y='9' width='13' height='13' rx='2' ry='2' />
                  <path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' />
                </svg>
              </div>
            ) : field.type === 'dropdown' ? (
              <div className='flex h-8 items-center justify-between rounded-md border border-fd-border bg-fd-background px-3 text-xs'>
                <span className='text-fd-muted-foreground'>
                  {field.options?.find((o) => o.id === field.value)?.label || field.placeholder || 'Select...'}
                </span>
                <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' className='text-fd-muted-foreground'>
                  <path d='M6 9l6 6 6-6' />
                </svg>
              </div>
            ) : field.type === 'toggle' ? (
              <div className='flex items-center gap-2'>
                <div className={`relative h-5 w-9 rounded-full ${field.value === 'true' ? 'bg-blue-500' : 'bg-fd-border'}`}>
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${field.value === 'true' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </div>
            ) : (
              <div className='flex h-8 items-center rounded-md border border-fd-border bg-fd-background px-3 text-xs text-fd-muted-foreground'>
                {field.value || field.placeholder || '...'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className='flex justify-end border-t border-fd-border px-4 py-3'>
        <div className='rounded-md bg-blue-500 px-4 py-1.5 text-xs font-medium text-white'>
          Deploy
        </div>
      </div>
    </div>
  )
}
