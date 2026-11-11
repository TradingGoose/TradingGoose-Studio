/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompletionRequest } from '@/lib/copilot/native/contract'
import { requestCopilotTitle } from './utils'

const state = vi.hoisted(() => ({ complete: vi.fn() }))
vi.mock('@/lib/copilot/native/completion', () => ({ completeCopilot: state.complete }))
const input = {
  message: 'Build a screener',
  userId: 'actor',
  workspaceId: null,
  model: 'openai/gpt-5.6-terra' as const,
}
const completed = {
  status: 'completed',
  runId: 'native-title-run',
  text: '  Momentum Screener  ',
}
beforeEach(() => {
  vi.clearAllMocks()
  state.complete.mockImplementation(async (request: CompletionRequest) => ({
    ...completed,
  }))
})
describe('built-in title completion', () => {
  it.each(['openai/gpt-5.6-terra', 'anthropic/claude-opus-5'] as const)(
    'uses shared local completion with selected %s and authenticated scope',
    async (model) => {
      const signal = new AbortController().signal
      expect(await requestCopilotTitle({ ...input, model, workspaceId: 'workspace', signal })).toBe(
        'Momentum Screener'
      )
      expect(state.complete).toHaveBeenCalledExactlyOnceWith(
        {
          scope: { actorUserId: 'actor', workspaceId: 'workspace' },
          purpose: 'title',
          model,
          messages: [
            {
              role: 'system',
              content: 'Generate a concise, descriptive chat title based on the user message.',
            },
            { role: 'user', content: 'Create a short title for this: Build a screener' },
          ],
        },
        signal
      )
    }
  )
  it('exposes accepted outcome even when cancellation prevents publication', async () => {
    const controller = new AbortController()
    state.complete.mockImplementationOnce(async (request: CompletionRequest) => {
      controller.abort()
      return { ...completed }
    })
    expect(await requestCopilotTitle({ ...input, signal: controller.signal })).toBeNull()
    expect(state.complete).toHaveBeenCalledOnce()
  })
  it.each(['failed', 'refused', 'cancel_requested'])(
    'publishes no title for %s and preserves the outcome',
    async (status) => {
      const outcome = {
        status,
        error: { code: 'FAILED', message: 'unavailable' },
      }
      state.complete.mockResolvedValueOnce(outcome)
      expect(await requestCopilotTitle({ ...input })).toBeNull()
      expect(state.complete).toHaveBeenCalledOnce()
    }
  )
  it('does not contact or retry after cancellation or local failure', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await requestCopilotTitle({ ...input, signal: controller.signal })).toBeNull()
    expect(state.complete).not.toHaveBeenCalled()
    state.complete.mockRejectedValueOnce(new Error('unavailable'))
    expect(await requestCopilotTitle(input)).toBeNull()
    expect(state.complete).toHaveBeenCalledOnce()
  })
  it('does not publish a whitespace title', async () => {
    state.complete.mockResolvedValueOnce({ ...completed, text: '  ' })
    expect(await requestCopilotTitle(input)).toBeNull()
  })
})
