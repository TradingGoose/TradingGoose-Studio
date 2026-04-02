'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SchemaField {
  name: string
  type: string
  description?: string
  children?: SchemaField[]
}

interface SchemaTreeProps {
  fields: SchemaField[]
  title?: string
}

/**
 * Renders a JSON-like schema as a collapsible tree.
 * Objects/arrays with children are expandable. Leaf fields show inline.
 */
export function SchemaTree({ fields, title }: SchemaTreeProps) {
  return (
    <div className='my-4 overflow-hidden rounded-lg border border-fd-border bg-fd-card text-sm'>
      {title && (
        <div className='border-b border-fd-border bg-fd-muted/30 px-4 py-2 text-xs font-semibold text-fd-muted-foreground uppercase tracking-wider'>
          {title}
        </div>
      )}
      <div className='p-2'>
        {fields.map((field) => (
          <SchemaNode key={field.name} field={field} depth={0} />
        ))}
      </div>
    </div>
  )
}

function SchemaNode({ field, depth }: { field: SchemaField; depth: number }) {
  const hasChildren = field.children && field.children.length > 0
  const [open, setOpen] = useState(depth === 0)

  const typeBadgeColor = getTypeBadgeColor(field.type)

  return (
    <div>
      <div
        className={cn(
          'flex items-start gap-2 rounded px-2 py-1.5 hover:bg-fd-muted/50',
          hasChildren && 'cursor-pointer'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={hasChildren ? () => setOpen(!open) : undefined}
      >
        {/* Expand/collapse indicator */}
        <div className='mt-0.5 w-4 shrink-0 text-fd-muted-foreground'>
          {hasChildren && (
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              className={cn('transition-transform duration-150', open && 'rotate-90')}
            >
              <path d='M9 18l6-6-6-6' />
            </svg>
          )}
        </div>

        {/* Field name */}
        <code className='shrink-0 text-xs font-semibold text-fd-foreground'>
          {field.name}
        </code>

        {/* Type badge */}
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            typeBadgeColor
          )}
        >
          {field.type}
        </span>

        {/* Description */}
        {field.description && field.description !== field.name && (
          <span className='truncate text-xs text-fd-muted-foreground'>
            {field.description}
          </span>
        )}
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div>
          {field.children!.map((child) => (
            <SchemaNode key={child.name} field={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case 'string':
      return 'bg-green-500/10 text-green-600 dark:text-green-400'
    case 'number':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    case 'boolean':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'array':
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
    case 'object':
    case 'json':
      return 'bg-fd-muted text-fd-muted-foreground'
    default:
      return 'bg-fd-muted text-fd-muted-foreground'
  }
}
