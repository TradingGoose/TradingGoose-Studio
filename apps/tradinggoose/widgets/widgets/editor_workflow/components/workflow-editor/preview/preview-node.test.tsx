import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('reactflow', () => ({
  Handle: ({ id, type, position }: { id: string; type: string; position: string }) =>
    createElement('div', {
      'data-testid': 'handle',
      'data-handle-id': id,
      'data-handle-type': type,
      'data-handle-position': position,
    }),
  Position: {
    Left: 'left',
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
  },
}))

vi.mock('@/blocks', () => ({
  getBlock: () => undefined,
}))

import { PreviewNode } from './preview-node'

describe('PreviewNode', () => {
  it('renders canonical read-only node chrome and handles for regular blocks', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewNode as any, {
        id: 'agent-1',
        data: {
          type: 'agent',
          name: 'Agent Node',
          config: {
            category: 'blocks',
            bgColor: '#00ccff',
            icon: (props: any) => createElement('svg', props),
          },
          blockState: {
            isWide: true,
            enabled: true,
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('Agent Node')
    expect(markup).toContain('agent')
    expect(markup).toContain('data-handle-id="target"')
    expect(markup).toContain('data-handle-id="source"')
    expect(markup).toContain('data-handle-id="error"')
  })

  it('omits input/error handles for trigger blocks', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewNode as any, {
        id: 'trigger-1',
        data: {
          type: 'generic_webhook',
          name: 'Trigger Node',
          config: {
            category: 'triggers',
            bgColor: '#22c55e',
            icon: (props: any) => createElement('svg', props),
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).not.toContain('data-handle-id="target"')
    expect(markup).toContain('data-handle-id="source"')
    expect(markup).not.toContain('data-handle-id="error"')
  })

  it('omits output handles for condition/response blocks', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewNode as any, {
        id: 'condition-1',
        data: {
          type: 'condition',
          name: 'Condition Node',
          config: {
            category: 'blocks',
            bgColor: '#f59e0b',
            icon: (props: any) => createElement('svg', props),
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('data-handle-id="target"')
    expect(markup).not.toContain('data-handle-id="source"')
    expect(markup).not.toContain('data-handle-id="error"')
  })

  it('uses horizontal handle ports when block requests horizontal handles', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewNode as any, {
        id: 'agent-horizontal',
        data: {
          type: 'agent',
          name: 'Agent Horizontal',
          config: {
            category: 'blocks',
            bgColor: '#00ccff',
            icon: (props: any) => createElement('svg', props),
          },
          blockState: {
            horizontalHandles: true,
            enabled: true,
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('data-handle-id="target"')
    expect(markup).toContain('data-handle-position="left"')
    expect(markup).toContain('data-handle-id="source"')
    expect(markup).toContain('data-handle-position="right"')
  })

  it('filters conditional preview rows before rendering duplicate subblock ids', () => {
    const markup = renderToStaticMarkup(
      createElement(PreviewNode as any, {
        id: 'custom-conditional',
        data: {
          type: 'custom-conditional',
          name: 'Conditional Node',
          config: {
            category: 'blocks',
            bgColor: '#00ccff',
            icon: (props: any) => createElement('svg', props),
            subBlocks: [
              {
                id: 'model',
                title: 'Model',
                type: 'short-input',
                layout: 'half',
              },
              {
                id: 'temperature',
                title: 'Temperature 0-1',
                type: 'slider',
                layout: 'half',
                condition: {
                  field: 'model',
                  value: ['range-1'],
                },
              },
              {
                id: 'temperature',
                title: 'Temperature 0-2',
                type: 'slider',
                layout: 'half',
                condition: {
                  field: 'model',
                  value: ['range-2'],
                },
              },
            ],
          },
          subBlockValues: {
            model: { value: 'range-2' },
            temperature: { value: 0.7 },
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('Temperature 0-2')
    expect(markup).not.toContain('Temperature 0-1')
  })
})
