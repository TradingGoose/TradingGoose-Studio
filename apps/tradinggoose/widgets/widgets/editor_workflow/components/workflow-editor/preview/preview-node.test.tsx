import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.mock('@xyflow/react', () => ({
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

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowI18n: () => ({
    workflowEditorCopy: {
      summary: {
        objectItem: 'Object',
        additionalCount: '+{count}',
      },
    },
    workflowLabelsCopy: {
      configured: 'Configured',
      error: 'error',
      fields: 'fields',
      items: 'items',
      object: 'object',
      value: 'value',
    },
    getLocalizedDefaultBlockName: (_blockType: string, blockName?: string) => blockName ?? 'Block',
    localizeWorkflowSubBlockConfig: (config: any) =>
      config?.id === 'selectedTriggerId' && Array.isArray(config?.options)
        ? {
            ...config,
            options: config.options.map((option: any) =>
              option?.id === 'calendly_webhook' ? { ...option, label: 'Calendly Webhook' } : option
            ),
          }
        : config,
    resolveWorkflowDisplayValue: (config: any, value: unknown) => {
      if (config?.options && typeof value === 'string') {
        return config.options.find((option: any) => option?.id === value)?.label ?? value
      }

      return value
    },
  }),
}))

import { PreviewNode } from './preview-node'

const renderPreviewMarkup = (node: ReactElement) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, node))

describe('PreviewNode', () => {
  it('renders canonical read-only node chrome and handles for regular blocks', () => {
    const markup = renderPreviewMarkup(
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
    const markup = renderPreviewMarkup(
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
    const markup = renderPreviewMarkup(
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
    const markup = renderPreviewMarkup(
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

  it('renders precomputed preview summaries when localized summary metadata is provided', () => {
    const markup = renderPreviewMarkup(
      createElement(PreviewNode as any, {
        id: 'agent-precomputed',
        data: {
          type: 'agent',
          name: 'Agent Node',
          title: 'Localized Agent',
          config: {
            category: 'blocks',
            bgColor: '#00ccff',
            icon: (props: any) => createElement('svg', props),
          },
          summaryRows: [
            {
              id: 'summary-1',
              kind: 'text',
              title: 'Model',
              value: 'gpt-5.4-mini',
            },
          ],
          objectItemLabel: 'Object',
          enabled: true,
          horizontalHandles: false,
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('Localized Agent')
    expect(markup).toContain('Model')
    expect(markup).toContain('gpt-5.4-mini')
  })

  it('throws when precomputed preview summaries are missing localized object item metadata', () => {
    expect(() =>
      renderPreviewMarkup(
        createElement(PreviewNode as any, {
          id: 'agent-precomputed-error',
          data: {
            type: 'agent',
            name: 'Agent Node',
            title: 'Localized Agent',
            config: {
              category: 'blocks',
              bgColor: '#00ccff',
              icon: (props: any) => createElement('svg', props),
            },
            summaryRows: [
              {
                id: 'summary-1',
                kind: 'text',
                title: 'Model',
                value: 'gpt-5.4-mini',
              },
            ],
            readOnly: true,
            isPreview: true,
          },
        })
      )
    ).toThrow('Missing localized object item label for precomputed preview summary rows.')
  })

  it('filters conditional preview rows before rendering duplicate subblock ids', () => {
    const markup = renderPreviewMarkup(
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

  it('renders both deploy-managed and editor-managed trigger fields in preview mode', () => {
    const markup = renderPreviewMarkup(
      createElement(PreviewNode as any, {
        id: 'trigger-preview-1',
        data: {
          type: 'github_issue_opened',
          name: 'GitHub Trigger',
          config: {
            category: 'triggers',
            bgColor: '#22c55e',
            icon: (props: any) => createElement('svg', props),
            triggers: {
              available: ['github_issue_opened'],
            },
            subBlocks: [
              {
                id: 'selectedTriggerId',
                title: 'Trigger Type',
                type: 'dropdown',
                mode: 'trigger',
              },
              {
                id: 'contentType',
                title: 'Content Type',
                type: 'short-input',
                mode: 'trigger',
                condition: {
                  field: 'selectedTriggerId',
                  value: 'github_issue_opened',
                },
              },
              {
                id: 'inputFormat',
                title: 'Input Format',
                type: 'short-input',
                mode: 'trigger',
                condition: {
                  field: 'selectedTriggerId',
                  value: 'github_issue_opened',
                },
              },
            ],
          },
          subBlockValues: {
            selectedTriggerId: { value: 'github_issue_opened' },
            contentType: { value: 'application/json' },
            inputFormat: { value: 'payload' },
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('Trigger Type')
    expect(markup).toContain('Content Type')
    expect(markup).toContain('application/json')
    expect(markup).toContain('Input Format')
    expect(markup).toContain('payload')
  })

  it('renders centralized trigger metadata labels instead of inline trigger option labels', () => {
    const markup = renderPreviewMarkup(
      createElement(PreviewNode as any, {
        id: 'trigger-preview-2',
        data: {
          type: 'calendly',
          name: 'Calendly Trigger Tool',
          config: {
            type: 'calendly',
            category: 'tools',
            bgColor: '#0ea5e9',
            icon: (props: any) => createElement('svg', props),
            triggers: {
              available: ['calendly_webhook'],
            },
            subBlocks: [
              {
                id: 'selectedTriggerId',
                title: 'Trigger Type',
                type: 'dropdown',
                mode: 'trigger',
                options: [{ id: 'calendly_webhook', label: 'General Webhook (All Events)' }],
              },
            ],
          },
          blockState: {
            triggerMode: true,
          },
          subBlockValues: {
            selectedTriggerId: { value: 'calendly_webhook' },
          },
          readOnly: true,
          isPreview: true,
        },
      })
    )

    expect(markup).toContain('Trigger Type')
    expect(markup).toContain('Calendly Webhook')
    expect(markup).not.toContain('General Webhook (All Events)')
  })
})
