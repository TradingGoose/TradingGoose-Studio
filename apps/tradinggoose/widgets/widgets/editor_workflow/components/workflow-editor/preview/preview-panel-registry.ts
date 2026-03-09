import { createElement, type ComponentType } from 'react'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface ReadOnlyPreviewPanelProps {
  block: BlockState
  readOnly?: true
}

function formatSubBlockValue(value: unknown): string {
  if (value == null) {
    return 'None'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return 'Unsupported value'
  }
}

function DefaultReadOnlyPreviewPanel({ block }: ReadOnlyPreviewPanelProps) {
  return createElement(
    'div',
    { className: 'space-y-4' },
    createElement(
      'div',
      { className: 'space-y-1' },
      createElement(
        'p',
        { className: 'text-muted-foreground text-xs uppercase tracking-wide' },
        'Block'
      ),
      createElement('p', { className: 'font-medium text-sm' }, block.name)
    ),
    createElement(
      'div',
      { className: 'space-y-1' },
      createElement(
        'p',
        { className: 'text-muted-foreground text-xs uppercase tracking-wide' },
        'Type'
      ),
      createElement('p', { className: 'font-mono text-xs' }, block.type)
    )
  )
}

function CanonicalReadOnlyPreviewPanel({ block }: ReadOnlyPreviewPanelProps) {
  const entries = Object.entries(block.subBlocks || {})

  if (entries.length === 0) {
    return createElement(
      'p',
      { className: 'text-muted-foreground text-xs' },
      'No values to display.'
    )
  }

  return createElement(
    'div',
    { className: 'space-y-3' },
    ...entries.map(([subBlockId, subBlockState]) =>
      createElement(
        'div',
        { key: subBlockId, className: 'space-y-1 border-border border-b pb-2 last:border-b-0' },
        createElement(
          'p',
          { className: 'text-muted-foreground text-[11px] uppercase tracking-wide' },
          subBlockId
        ),
        createElement(
          'p',
          { className: 'text-sm break-words' },
          formatSubBlockValue(subBlockState?.value)
        )
      )
    )
  )
}

const CANONICAL_PREVIEW_TYPES = new Set<string>([...Object.keys(blockRegistry), 'loop', 'parallel'])

export function resolveReadOnlyPreviewPanel(
  type: string
): ComponentType<ReadOnlyPreviewPanelProps> {
  return CANONICAL_PREVIEW_TYPES.has(type)
    ? CanonicalReadOnlyPreviewPanel
    : DefaultReadOnlyPreviewPanel
}
