/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmStreamDelta } from '@/lib/copilot/local-runtime/types'

const { cache, mockStreamLlm, mockGetApiKey } = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  mockStreamLlm: vi.fn(),
  mockGetApiKey: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  getCachedValue: async (key: string) => cache.get(key) ?? null,
  setCachedValue: async (key: string, value: string) => {
    cache.set(key, value)
  },
  deleteCachedValue: async (key: string) => {
    cache.delete(key)
  },
}))

vi.mock('@/lib/copilot/local-runtime/llm', () => ({
  streamLlm: (...args: unknown[]) => mockStreamLlm(...args),
}))

vi.mock('@/providers/ai/utils-server', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}))

vi.mock('@/lib/copilot/runtime-tool-manifest', () => ({
  getCopilotRuntimeToolManifest: async () => ({
    version: 'v1',
    tools: [{ name: 'read_workflow', description: 'Read a workflow.', parameters: {} }],
  }),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function deltaStream(deltas: LlmStreamDelta[]) {
  return async function* () {
    for (const delta of deltas) yield delta
  }
}

async function readEvents(response: Response): Promise<Record<string, any>[]> {
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
}

describe('local copilot runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cache.clear()
    mockGetApiKey.mockResolvedValue('test-key')
  })

  it('streams a text-only turn as the hosted SSE vocabulary', async () => {
    mockStreamLlm.mockReturnValue(
      deltaStream([
        { type: 'reasoning', delta: 'thinking' },
        { type: 'text', delta: 'Hello ' },
        { type: 'text', delta: 'world' },
      ])()
    )

    const { runLocalCopilotTurn } = await import('./runtime')
    const events = await readEvents(
      await runLocalCopilotTurn({ message: 'hi', userId: 'user-1', model: 'claude-sonnet-4.6' })
    )

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'response.output_item.added',
      'response.reasoning_text.delta',
      'response.output_item.done',
      'response.output_item.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_item.done',
      'response.completed',
    ])

    const finalText = events.at(-2)
    expect(finalText?.item).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello world' }],
    })
  })

  it('parks the turn on tool calls instead of executing them', async () => {
    mockStreamLlm.mockReturnValue(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{"entityId"' },
        { type: 'tool_call_arguments', index: 0, delta: ':"wf-1"}' },
      ])()
    )

    const { runLocalCopilotTurn } = await import('./runtime')
    const events = await readEvents(
      await runLocalCopilotTurn({ message: 'read it', userId: 'user-1', model: 'gpt-5.4' })
    )

    const functionCall = events.find((event) => event.item?.type === 'function_call')
    expect(functionCall?.item).toMatchObject({
      call_id: 'call-1',
      name: 'read_workflow',
      arguments: '{"entityId":"wf-1"}',
    })

    const awaiting = events.at(-1)
    expect(awaiting).toMatchObject({
      type: 'awaiting_tools',
      data: { pendingToolCallIds: ['call-1'] },
    })
    expect(events.some((event) => event.type === 'response.completed')).toBe(false)
  })

  it('resumes the turn once the browser reports the tool result', async () => {
    mockStreamLlm.mockReturnValueOnce(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{}' },
      ])()
    )

    const { runLocalCopilotTurn, resumeLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({ message: 'read it', userId: 'user-1', model: 'gpt-5.4' })
    )

    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'Done.' }])())

    const continuation = await resumeLocalCopilotTurn(
      { id: 'call-1', name: 'read_workflow', status: 200, data: { blocks: 3 } },
      'user-1'
    )

    expect(continuation).not.toBeNull()
    const events = await readEvents(continuation!)
    // A continuation is mid-turn, so it must not re-announce `start`.
    expect(events.some((event) => event.type === 'start')).toBe(false)
    expect(events.at(-1)?.type).toBe('response.completed')

    const messages = mockStreamLlm.mock.calls[1][0].messages
    expect(messages).toEqual([
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_workflow', arguments: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        name: 'read_workflow',
        content: '{"blocks":3}',
      },
    ])
  })

  it('holds the turn until every parallel tool call has reported', async () => {
    mockStreamLlm.mockReturnValueOnce(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{}' },
        { type: 'tool_call_start', index: 1, id: 'call-2', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 1, delta: '{}' },
      ])()
    )

    const { runLocalCopilotTurn, resumeLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({ message: 'read both', userId: 'user-1', model: 'gpt-5.4' })
    )

    const firstResume = await resumeLocalCopilotTurn(
      { id: 'call-1', name: 'read_workflow', status: 200 },
      'user-1'
    )
    expect(firstResume).toBeNull()
    expect(mockStreamLlm).toHaveBeenCalledTimes(1)

    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'Both read.' }])())
    const secondResume = await resumeLocalCopilotTurn(
      { id: 'call-2', name: 'read_workflow', status: 200 },
      'user-1'
    )
    expect(secondResume).not.toBeNull()
    await readEvents(secondResume!)
    expect(mockStreamLlm).toHaveBeenCalledTimes(2)
  })

  it('reports a failed tool call to the model rather than an empty result', async () => {
    mockStreamLlm.mockReturnValueOnce(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{}' },
      ])()
    )

    const { runLocalCopilotTurn, resumeLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({ message: 'read it', userId: 'user-1', model: 'gpt-5.4' })
    )

    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'Sorry.' }])())
    await readEvents(
      (await resumeLocalCopilotTurn(
        { id: 'call-1', name: 'read_workflow', status: 500, message: 'workflow not found' },
        'user-1'
      ))!
    )

    const messages = mockStreamLlm.mock.calls[1][0].messages
    expect(messages.at(-1)).toMatchObject({
      role: 'tool',
      content: '{"success":false,"error":"workflow not found"}',
    })
  })

  it('refuses a conversation that belongs to another user', async () => {
    mockStreamLlm.mockReturnValueOnce(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{}' },
      ])()
    )

    const { runLocalCopilotTurn, resumeLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({ message: 'read it', userId: 'user-1', model: 'gpt-5.4' })
    )

    const stolen = await resumeLocalCopilotTurn(
      { id: 'call-1', name: 'read_workflow', status: 200 },
      'user-2'
    )
    expect(stolen).toBeNull()
  })

  it('rebuilds context from persisted history when nothing is cached', async () => {
    mockStreamLlm.mockReturnValue(deltaStream([{ type: 'text', delta: 'sure' }])())

    const { runLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({
        message: 'and now?',
        userId: 'user-1',
        model: 'gpt-5.4',
        conversationId: 'expired-conversation',
        history: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'first answer' },
          // Blank and non-conversational rows must not reach the model.
          { role: 'assistant', content: '   ' },
          { role: 'system', content: 'internal note' },
        ],
      })
    )

    expect(mockStreamLlm.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'and now?' },
    ])
  })

  it('prefers cached state over the persisted history it was given', async () => {
    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'first answer' }])())

    const { runLocalCopilotTurn } = await import('./runtime')
    const events = await readEvents(
      await runLocalCopilotTurn({ message: 'first question', userId: 'user-1', model: 'gpt-5.4' })
    )
    const conversationId = events[0].data.conversationId

    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'second answer' }])())
    await readEvents(
      await runLocalCopilotTurn({
        message: 'second question',
        userId: 'user-1',
        model: 'gpt-5.4',
        conversationId,
        history: [{ role: 'user', content: 'stale history that must be ignored' }],
      })
    )

    expect(mockStreamLlm.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ])
  })

  it('tells the model the workspace id, which no tool can look up', async () => {
    mockStreamLlm.mockReturnValue(deltaStream([{ type: 'text', delta: 'ok' }])())

    const { runLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({
        message: 'list my workflows',
        userId: 'user-1',
        model: 'gpt-5.4',
        workspaceId: 'ws-42',
      })
    )

    expect(mockStreamLlm.mock.calls[0][0].systemPrompt).toContain('`ws-42`')
  })

  it('tells the model not to guess when the chat has no workspace', async () => {
    mockStreamLlm.mockReturnValue(deltaStream([{ type: 'text', delta: 'ok' }])())

    const { runLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({ message: 'hi', userId: 'user-1', model: 'gpt-5.4' })
    )

    expect(mockStreamLlm.mock.calls[0][0].systemPrompt).toContain('not scoped to a workspace')
  })

  it('keeps the workspace id across a tool-call resume', async () => {
    mockStreamLlm.mockReturnValueOnce(
      deltaStream([
        { type: 'tool_call_start', index: 0, id: 'call-1', name: 'read_workflow' },
        { type: 'tool_call_arguments', index: 0, delta: '{}' },
      ])()
    )

    const { runLocalCopilotTurn, resumeLocalCopilotTurn } = await import('./runtime')
    await readEvents(
      await runLocalCopilotTurn({
        message: 'read it',
        userId: 'user-1',
        model: 'gpt-5.4',
        workspaceId: 'ws-42',
      })
    )

    mockStreamLlm.mockReturnValueOnce(deltaStream([{ type: 'text', delta: 'Done.' }])())
    await readEvents(
      (await resumeLocalCopilotTurn(
        { id: 'call-1', name: 'read_workflow', status: 200 },
        'user-1'
      ))!
    )

    expect(mockStreamLlm.mock.calls[1][0].systemPrompt).toContain('`ws-42`')
  })

  it('rejects a model whose provider the local runtime cannot drive', async () => {
    const { runLocalCopilotTurn } = await import('./runtime')
    const events = await readEvents(
      await runLocalCopilotTurn({ message: 'hi', userId: 'user-1', model: 'bedrock/anything' })
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    expect(mockStreamLlm).not.toHaveBeenCalled()
  })
})
