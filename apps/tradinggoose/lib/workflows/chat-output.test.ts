import { describe, expect, it } from 'vitest'
import type { WorkflowExecutionEvent } from '@/lib/workflows/execution-events'
import { Executor } from '@/executor'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { createChatOutputEventReader } from './chat-output'

function containerWorkflow(type: 'loop' | 'parallel', mode: string, count: number) {
  const block = (id: string, blockType: string, params = {}): SerializedBlock => ({
    id,
    position: { x: 0, y: 0 },
    config: { tool: blockType, params },
    inputs: {},
    outputs: {},
    metadata: { id: blockType, name: id, category: id === 'trigger' ? 'triggers' : 'blocks' },
    enabled: true,
  })
  const items = Array.from({ length: count }, (_, index) => index)
  const workflow: SerializedWorkflow = {
    version: '1.0',
    blocks: [
      block('trigger', 'input_trigger'),
      block('before', 'response', { dataMode: 'json', data: '{"notice":"before"}' }),
      block('container', type),
      block('body', 'response', {
        dataMode: 'json',
        data: `{"answer":42,"index":<${type}.index>}`,
      }),
    ],
    connections: [
      { source: 'trigger', target: 'before' },
      { source: 'before', target: 'container' },
      { source: 'container', target: 'body', sourceHandle: `${type}-start-source` },
      { source: 'body', target: 'container' },
    ],
    loops:
      type === 'loop'
        ? {
            container: {
              id: 'container',
              nodes: ['body'],
              loopType: mode as 'for' | 'forEach',
              iterations: count,
              forEachItems: items,
            },
          }
        : {},
    parallels:
      type === 'parallel'
        ? {
            container: {
              id: 'container',
              nodes: ['body'],
              parallelType: mode as 'count' | 'collection',
              count,
              distribution: items,
            },
          }
        : {},
  }
  return workflow
}

describe('createChatOutputEventReader', () => {
  it.each([
    ['loop', 'for'],
    ['loop', 'forEach'],
    ['parallel', 'count'],
    ['parallel', 'collection'],
  ] as const)(
    'delivers completed %s %s aggregates live and from final logs',
    async (type, mode) => {
      for (const count of [1, 2]) {
        const reader = createChatOutputEventReader([
          'before_response.data.notice',
          'container_results',
        ])
        const events: WorkflowExecutionEvent[] = []
        const content: string[] = []
        const result = await new Executor({
          workflow: containerWorkflow(type, mode, count),
          contextExtensions: {
            workspaceId: 'workspace-1',
            onExecutionEvent: async (event) => {
              const completeEvent = {
                ...event,
                executionId: 'execution-1',
                workflowId: 'workflow-1',
                timestamp: event.timestamp ?? new Date().toISOString(),
              } as WorkflowExecutionEvent
              events.push(completeEvent)
              for (const output of reader.readEvent(completeEvent)) {
                if (output.type === 'content') content.push(output.content)
              }
            },
          },
        }).execute('workflow-1', 'trigger')

        expect(result.success).toBe(true)
        const completionEvents = events.filter(
          (event) => event.type === 'block:completed' && event.data.blockId === 'container'
        )
        expect(completionEvents).toHaveLength(1)
        expect(completionEvents[0].data).toMatchObject({ output: { completed: true } })
        const aggregates = Array.from({ length: count }, (_, index) => ({
          response: {
            data: { answer: 42, index },
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        }))
        expect(content).toEqual(['before', `\n\n${JSON.stringify(aggregates, null, 2)}`])
        const terminalEvent = {
          type: 'execution:completed',
          executionId: 'execution-1',
          workflowId: 'workflow-1',
          timestamp: new Date().toISOString(),
          data: { result },
        } as const
        expect(reader.readEvent(terminalEvent)).toEqual([{ type: 'final', success: true, result }])
        expect(createChatOutputEventReader(['container_results']).readEvent(terminalEvent)).toEqual(
          [
            { type: 'content', blockId: 'workflow', content: JSON.stringify(aggregates, null, 2) },
            { type: 'final', success: true, result },
          ]
        )
      }
    }
  )

  it.each([[], ['new', 'extra'], 'invalid'].map((nextItems) => ({ nextItems })))(
    'completes For Each after its last child changes the collection to $nextItems',
    async ({ nextItems }) => {
      const workflow = containerWorkflow('loop', 'forEach', 1)
      workflow.loops.container.forEachItems = '<variable.items>'
      workflow.loops.container.nodes.push('mutate')
      workflow.blocks.push({
        ...workflow.blocks[3],
        id: 'mutate',
        metadata: { id: 'variables', name: 'mutate' },
        config: {
          tool: 'variables',
          params: {
            variables: [
              {
                variableId: 'items',
                variableName: 'items',
                type: Array.isArray(nextItems) ? 'array' : 'plain',
                value: nextItems,
              },
            ],
          },
        },
      })
      workflow.connections.pop()
      workflow.connections.push(
        { source: 'body', target: 'mutate' },
        { source: 'mutate', target: 'container' }
      )
      const completed: unknown[] = []
      const result = await new Executor({
        workflow,
        workflowVariables: { items: { name: 'items', type: 'array', value: [0] } },
        contextExtensions: {
          workspaceId: 'workspace-1',
          onExecutionEvent: async (event) => {
            if (event.type === 'block:completed' && event.data.blockId === 'container') {
              completed.push(event.data.output)
            }
          },
        },
      }).execute('workflow-1', 'trigger')

      expect(result.success).toBe(true)
      expect(completed).toEqual([
        expect.objectContaining({
          completed: true,
          maxIterations: 1,
          results: [
            [expect.objectContaining({ response: expect.any(Object) }), { items: nextItems }],
          ],
        }),
      ])
    }
  )

  it('treats empty selections as streamable content and errors by selected block', () => {
    const allOutputsReader = createChatOutputEventReader([])

    expect(
      allOutputsReader.readEvent({
        type: 'block:completed',
        data: { blockId: 'agent-1', output: { content: 'visible', summary: 'hidden' } },
      } as any)
    ).toEqual([{ type: 'content', blockId: 'agent-1', content: 'visible' }])

    const selectedReader = createChatOutputEventReader(['agent-1_summary'])

    expect(
      selectedReader.readEvent({
        type: 'block:error',
        data: { blockId: 'agent-1', error: 'Agent failed' },
      } as any)
    ).toEqual([{ type: 'error', blockId: 'agent-1', message: 'Agent failed' }])
  })

  it('shows the review link while preserving paused status in the chat final result', () => {
    const reader = createChatOutputEventReader(['agent-1_content'])
    const result = {
      success: true,
      status: 'paused' as const,
      output: { url: '/review', revision: 2 },
      logs: [],
    }
    expect(
      reader.readEvent({
        type: 'execution:paused',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: { result },
      })
    ).toEqual([
      { type: 'content', blockId: 'workflow', content: 'Workflow is paused for review: /review' },
      { type: 'final', success: true, result },
    ])
  })
})
