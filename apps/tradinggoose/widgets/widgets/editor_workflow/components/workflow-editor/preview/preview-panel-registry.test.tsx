import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolveReadOnlyPreviewPanel } from './preview-panel-registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

function createBlock(
  overrides: Partial<BlockState> & Pick<BlockState, 'id' | 'type' | 'name'>
): BlockState {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    subBlocks: overrides.subBlocks ?? {},
    outputs: overrides.outputs ?? ({} as any),
    enabled: overrides.enabled ?? true,
    horizontalHandles: overrides.horizontalHandles,
    isWide: overrides.isWide,
    height: overrides.height,
    advancedMode: overrides.advancedMode,
    triggerMode: overrides.triggerMode,
    data: overrides.data,
    layout: overrides.layout,
  }
}

describe('preview-panel-registry', () => {
  it('resolves pilot types to the read-only pilot panel and formats values', () => {
    const block = createBlock({
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      subBlocks: {
        enabled: { id: 'enabled', type: 'switch', value: true } as any,
        retries: { id: 'retries', type: 'short-input', value: 3 } as any,
        config: { id: 'config', type: 'json', value: { mode: 'safe' } } as any,
        optional: { id: 'optional', type: 'short-input', value: null } as any,
      },
    })

    const Panel = resolveReadOnlyPreviewPanel('agent')
    const markup = renderToStaticMarkup(createElement(Panel, { block, readOnly: true }))

    expect(markup).toContain('enabled')
    expect(markup).toContain('true')
    expect(markup).toContain('retries')
    expect(markup).toContain('3')
    expect(markup).toContain('config')
    expect(markup).toContain('safe')
    expect(markup).toContain('optional')
    expect(markup).toContain('None')
  })

  it('resolves registered types to canonical read-only panel', () => {
    const block = createBlock({
      id: 'condition-1',
      type: 'condition',
      name: 'Condition Block',
    })

    const Panel = resolveReadOnlyPreviewPanel('condition')
    const markup = renderToStaticMarkup(createElement(Panel, { block, readOnly: true }))

    expect(markup).toContain('No values to display.')
  })

  it('falls back to the default panel for unknown types', () => {
    const block = createBlock({
      id: 'unknown-1',
      type: 'unknown_type',
      name: 'Unknown Block',
    })

    const Panel = resolveReadOnlyPreviewPanel('unknown_type')
    const markup = renderToStaticMarkup(createElement(Panel, { block, readOnly: true }))

    expect(markup).toContain('Block')
    expect(markup).toContain('Unknown Block')
    expect(markup).toContain('Type')
    expect(markup).toContain('unknown_type')
  })
})
