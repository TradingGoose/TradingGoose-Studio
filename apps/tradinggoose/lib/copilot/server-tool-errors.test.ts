import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  buildCopilotServerToolErrorResponse,
  StructuredServerToolError,
} from '@/lib/copilot/server-tool-errors'

describe('copilot server tool errors', () => {
  it('maps malformed workflow document errors to repairable 422 responses', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error('Workflow document did not contain any TG_BLOCK entries')
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_document_missing_blocks',
        retryable: true,
      }),
    })
    expect(response.body.error).toContain('standalone `%% TG_BLOCK')
    expect(response.body.hint).toContain('Do not embed `TG_BLOCK` JSON inside node labels')
  })

  it('returns container and condition repair guidance for workflow edge mismatches', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Workflow document edge metadata is inconsistent. Visible Mermaid connections and TG_EDGE payloads must resolve to the same logical workflow edges.'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_document_edge_mismatch',
        retryable: true,
      }),
    })
    expect(response.body.hint).toContain('container subgraphs')
    expect(response.body.hint).toContain('condition blocks')
  })

  it('falls back to a generic 500 payload for unknown tool failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'make_api_request',
      new Error('socket hang up')
    )

    expect(response).toEqual({
      status: 500,
      body: {
        code: 'server_tool_execution_failed',
        error: 'socket hang up',
        retryable: false,
      },
    })
  })

  it('returns a structured 422 payload for tool argument schema failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'make_api_request',
      new z.ZodError([
        {
          code: z.ZodIssueCode.invalid_type,
          expected: 'string',
          received: 'undefined',
          path: ['url'],
          message: 'Required',
        },
        {
          code: z.ZodIssueCode.invalid_enum_value,
          options: ['GET', 'POST', 'PUT'],
          path: ['method'],
          received: 'get',
          message: "Invalid enum value. Expected 'GET' | 'POST' | 'PUT', received 'get'",
        },
      ])
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_tool_payload',
        retryable: true,
      }),
    })
    expect(response.body.error).toContain('Invalid make_api_request payload')
    expect(response.body.error).toContain('url: Required')
    expect(response.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'url', message: 'Required' }),
        expect.objectContaining({ path: 'method' }),
      ])
    )
  })

  it('passes through structured server tool errors without collapsing them to 500', () => {
    const response = buildCopilotServerToolErrorResponse(
      'search_documentation',
      new StructuredServerToolError({
        status: 503,
        body: {
          code: 'search_documentation_unavailable',
          error: 'Documentation search is unavailable because no embedding provider is configured.',
          hint:
            'Configure the OpenAI default API key or Azure OpenAI embedding service to enable documentation search.',
          retryable: false,
        },
      })
    )

    expect(response).toEqual({
      status: 503,
      body: {
        code: 'search_documentation_unavailable',
        error: 'Documentation search is unavailable because no embedding provider is configured.',
        hint:
          'Configure the OpenAI default API key or Azure OpenAI embedding service to enable documentation search.',
        retryable: false,
      },
    })
  })
})
