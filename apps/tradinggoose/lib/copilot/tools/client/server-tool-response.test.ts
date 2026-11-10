import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptCopilotServerToolReview,
  buildCopilotServerToolError,
  executeCopilotServerTool,
  rejectCopilotServerToolReview,
} from '@/lib/copilot/tools/client/server-tool-response'

describe('server-tool-response', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('preserves status and hint for structured JSON server errors', async () => {
    const error = (await buildCopilotServerToolError(
      new Response(
        JSON.stringify({
          error: 'Invalid make_api_request payload',
          hint: 'Use uppercase HTTP methods.',
          retryable: true,
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )) as Error & { status?: number }

    expect(error.status).toBe(422)
    expect(error.message).toContain('Invalid make_api_request payload')
    expect(error.message).toContain('Hint: Use uppercase HTTP methods.')
  })

  it('includes structured issues in the surfaced error message', async () => {
    const error = (await buildCopilotServerToolError(
      new Response(
        JSON.stringify({
          error: 'Invalid edit_workflow payload',
          issues: [
            {
              path: 'workflowDocument.functionBlock.subBlocks.code.value',
              message: 'Expected valid raw TypeScript function-body code.',
            },
          ],
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )) as Error & { status?: number }

    expect(error.status).toBe(422)
    expect(error.message).toContain('Invalid edit_workflow payload')
    expect(error.message).toContain(
      'workflowDocument.functionBlock.subBlocks.code.value: Expected valid raw TypeScript function-body code.'
    )
  })

  it('preserves status for plain text server errors', async () => {
    const error = (await buildCopilotServerToolError(
      new Response('socket hang up', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    )) as Error & { status?: number }

    expect(error.status).toBe(500)
    expect(error.message).toBe('socket hang up')
  })
  it('preserves complete authoritative result and proof while submitting only native lookup/action envelope', async () => {
    const target = {
      threadId: 'thread',
      resourceId: 'personal-resource',
      runId: 'run',
      toolCallId: 'call',
      toolName: 'read_workflow',
    }
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: { actual: 'business-result' },
        proof: 'purpose-specific-proof',
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    expect(
      await executeCopilotServerTool({
        native: { workspaceId: null, target },
        action: 'execute',
        signal: controller.signal,
      })
    ).toEqual({
      success: true,
      result: { actual: 'business-result' },
      proof: 'purpose-specific-proof',
    })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/copilot/execute-copilot-server-tool',
      expect.objectContaining({ method: 'POST', signal: controller.signal })
    )
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      native: { workspaceId: null, target },
      action: 'execute',
    })
  })
  it('review acceptance carries bound native target/token without replacing original business args', async () => {
    const native = {
      workspaceId: 'conversation-workspace',
      target: {
        threadId: 'thread',
        resourceId: 'resource',
        runId: 'run',
        toolCallId: 'call',
        toolName: 'edit_workflow',
      },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ success: true, result: { accepted: true }, proof: 'signed' })
      )
    vi.stubGlobal('fetch', fetchMock)
    expect(await acceptCopilotServerToolReview({ native, reviewToken: 'bound-token' })).toEqual({
      success: true,
      result: { accepted: true },
      proof: 'signed',
    })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      native,
      reviewToken: 'bound-token',
      action: 'review.accept',
    })
  })
  it('business preview remains distinguishable from final proof and error does not fabricate successful result', async () => {
    const input = {
      native: {
        workspaceId: null,
        target: {
          threadId: 'thread',
          resourceId: 'resource',
          runId: 'run',
          toolCallId: 'call',
          toolName: 'edit_workflow',
        },
      },
      action: 'execute' as const,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ success: true, result: { requiresReview: true, reviewToken: 'review' } })
      )
      .mockResolvedValueOnce(
        Response.json({ error: 'Original acceptance unavailable' }, { status: 409 })
      )
    vi.stubGlobal('fetch', fetchMock)
    expect(await executeCopilotServerTool(input)).toEqual({
      success: true,
      result: { requiresReview: true, reviewToken: 'review' },
    })
    await expect(executeCopilotServerTool(input)).rejects.toThrow('Original acceptance unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('rejects only through the internal native lookup/token and retains the full signed decision', async () => {
    const native = {
      workspaceId: null,
      target: {
        threadId: 'thread',
        resourceId: 'resource',
        runId: 'run',
        toolCallId: 'call',
        toolName: 'edit_workflow',
      },
    }
    const result = { success: false, rejected: true, toolName: 'edit_workflow' }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ success: true, result, proof: 'signed-rejection' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await rejectCopilotServerToolReview({ native, reviewToken: 'original' })).toEqual({
      success: true,
      result,
      proof: 'signed-rejection',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      native,
      reviewToken: 'original',
      action: 'review.reject',
    })
  })
})
