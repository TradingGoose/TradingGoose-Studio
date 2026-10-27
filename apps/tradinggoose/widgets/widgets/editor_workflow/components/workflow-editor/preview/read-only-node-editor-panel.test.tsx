import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { ReadOnlyNodeEditorPanel } from './read-only-node-editor-panel'

vi.mock('@/blocks', () => ({
  getBlock: vi.fn((type: string) =>
    type === 'agent'
      ? {
          category: 'blocks',
          triggers: undefined,
          subBlocks: [
            {
              id: 'memories',
              title: 'Memories',
              type: 'short-input',
              mode: 'advanced',
            },
            {
              id: 'responseFormat',
              title: 'Response Format',
              type: 'code',
              language: 'json',
            },
          ],
        }
      : type === 'loop' || type === 'parallel'
        ? {
            category: 'blocks',
            subBlocks:
              type === 'loop'
                ? [
                    { id: 'loopType', title: 'Type', type: 'dropdown' },
                    {
                      id: 'iterations',
                      title: 'Iterations',
                      type: 'short-input',
                      condition: { field: 'loopType', value: 'for' },
                    },
                    {
                      id: 'forEachItems',
                      title: 'Collection',
                      type: 'long-input',
                      condition: { field: 'loopType', value: 'forEach' },
                    },
                    {
                      id: 'whileCondition',
                      title: 'While Condition',
                      type: 'long-input',
                      condition: { field: 'loopType', value: ['while', 'doWhile'] },
                    },
                  ]
                : [
                    { id: 'parallelType', title: 'Type', type: 'dropdown' },
                    {
                      id: 'count',
                      title: 'Count',
                      type: 'short-input',
                      condition: { field: 'parallelType', value: 'count' },
                    },
                    {
                      id: 'distribution',
                      title: 'Distribution',
                      type: 'long-input',
                      condition: { field: 'parallelType', value: 'collection' },
                    },
                  ],
          }
        : undefined
  ),
}))

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowI18n: () => ({
    workflowEditorCopy: {
      previewInspector: 'Preview Inspector',
      selectBlockToViewPreviewDetails: 'Select a block to view its preview details.',
      nodeNotFound: 'Node not found',
      selectedNodeUnavailable: 'The selected node is no longer available.',
      loopTypeLabel: 'Type',
      loopIterations: 'Iterations',
      collectionItems: 'Collection',
      whileCondition: 'While Condition',
      parallelTypeLabel: 'Parallel Type',
      parallelExecutions: 'Executions',
      summary: {
        objectItem: 'Object',
        additionalCount: '+{count}',
      },
    },
    readOnlyPreviewCopy: {
      noValuesToDisplay: 'No values to display.',
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
    localizeWorkflowSubBlockConfig: (config: any) => config,
    resolveWorkflowDisplayValue: (config: any, value: unknown) => {
      if (config?.options && typeof value === 'string') {
        return config.options.find((option: any) => option?.id === value)?.label ?? value
      }

      return value
    },
  }),
}))

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      agent_1: {
        id: 'agent_1',
        type: 'agent',
        name: 'Agent One',
        position: { x: 0, y: 0 },
        subBlocks: {
          responseFormat: { id: 'responseFormat', type: 'code', value: 'hello' } as any,
          memories: { id: 'memories', type: 'short-input', value: 'memory_1' } as any,
        },
        outputs: {} as any,
        enabled: true,
      },
      loop_1: {
        id: 'loop_1',
        type: 'loop',
        name: 'Loop One',
        position: { x: 0, y: 0 },
        subBlocks: {
          loopType: { id: 'loopType', type: 'dropdown', value: 'forEach' },
          iterations: { id: 'iterations', type: 'short-input', value: 12 },
          forEachItems: { id: 'forEachItems', type: 'long-input', value: '{{items}}' },
          whileCondition: { id: 'whileCondition', type: 'long-input', value: 'ready' },
        },
        outputs: {} as any,
        enabled: true,
      },
    },
    edges: [],
    loops: {
      loop_1: {
        id: 'loop_1',
        nodes: [],
        loopType: 'for',
        iterations: 3,
      } as any,
    },
    parallels: {},
  }
}

const renderPreviewMarkup = (node: ReactElement) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, node))

describe('ReadOnlyNodeEditorPanel', () => {
  it('renders empty selection state when no node is selected', () => {
    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: null,
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Select a block to view its preview details.')
  })

  it('renders missing-node state when selected id is not present', () => {
    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'missing',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Node not found')
    expect(markup).toContain('no longer available')
  })

  it('renders inspector header and canonical summary rows for selected node', () => {
    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'agent_1',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Preview Inspector')
    expect(markup).toContain('Agent One')
    expect(markup).toContain('Response Format')
    expect(markup).toContain('hello')
    expect(markup).toContain('Memories')
    expect(markup).toContain('memory_1')
  })

  it('evaluates preview conditions for canonical loop nodes', () => {
    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'loop_1',
        workflowState: createWorkflowState(),
      })
    )

    expect(markup).toContain('Loop One')
    expect(markup).toContain('Collection')
    expect(markup).toContain('{{items}}')
    expect(markup).not.toContain('Iterations')
  })

  it.each(['while', 'doWhile'])('renders the canonical %s condition', (loopType) => {
    const workflowState = createWorkflowState()
    workflowState.blocks.loop_1.subBlocks.loopType.value = loopType
    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'loop_1',
        workflowState,
      })
    )

    expect(markup).toContain('While Condition')
    expect(markup).toContain('ready')
    expect(markup).not.toContain('Collection')
    expect(markup).not.toContain('Iterations')
  })

  it('renders parallel collection configuration from canonical sub-block values', () => {
    const workflowState = createWorkflowState()
    workflowState.blocks.parallel_1 = {
      ...workflowState.blocks.loop_1,
      id: 'parallel_1',
      type: 'parallel',
      name: 'Parallel One',
      subBlocks: {
        parallelType: { id: 'parallelType', type: 'dropdown', value: 'collection' },
        count: { id: 'count', type: 'short-input', value: 6 },
        distribution: { id: 'distribution', type: 'long-input', value: '{{symbols}}' },
      },
    }
    workflowState.parallels.parallel_1 = {
      id: 'parallel_1',
      nodes: [],
      parallelType: 'count',
      count: 2,
    }

    const markup = renderPreviewMarkup(
      createElement(ReadOnlyNodeEditorPanel, {
        selectedNodeId: 'parallel_1',
        workflowState,
      })
    )

    expect(markup).toContain('Distribution')
    expect(markup).toContain('{{symbols}}')
    expect(markup).not.toContain('Count')
  })
})
