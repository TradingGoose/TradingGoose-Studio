import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  buildCopilotServerToolErrorResponse,
  StructuredServerToolError,
} from '@/lib/copilot/server-tool-errors'
import { createDashboardLayoutValidationError } from '@/widgets/layout-document'
import { createWidgetConfigValidationError } from '@/widgets/widget-mutations'

describe('copilot server tool errors', () => {
  it('returns container repair guidance for invalid canonical container edge handles', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid container edge: parallel1 container input requires targetHandle "target" for incoming outer edges.'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_document_container_edge',
        retryable: true,
        issues: [
          {
            path: 'entityDocument.edges',
            message:
              'Invalid container edge: parallel1 container input requires targetHandle "target" for incoming outer edges.',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('connect outer edges')
  })

  it('preserves embedded workflow sub-block paths in structured edit errors', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid edited workflow: Document contract is inconsistent: invalid block sub-block values for functionBlock.subBlocks.code.value (Expected valid raw TypeScript function-body code.).'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_state',
        retryable: true,
        issues: [
          {
            path: 'entityDocument.functionBlock.subBlocks.code.value',
            message: 'Expected valid raw TypeScript function-body code.',
          },
        ],
      }),
    })
  })

  it('returns explicit removal guidance for omitted workflow blocks', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error(
        'Invalid edited workflow: Existing block ids omitted from edit_workflow entityDocument without removedBlockIds: fn1.'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_state',
        retryable: true,
      }),
    })
    expect(response.body.hint).toContain('removedBlockIds')
  })

  it('returns retryable graph-document guidance for malformed edit workflow Mermaid', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_workflow',
      new Error('Workflow graph Mermaid must start with `flowchart TD` or `flowchart LR`.')
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_workflow_graph_document',
        retryable: true,
        issues: [
          {
            path: 'entityDocument',
            message: 'Workflow graph Mermaid must start with `flowchart TD` or `flowchart LR`.',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('minimal Mermaid graph')
  })

  it('falls back to a generic 500 payload for unknown tool failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'make_api_request',
      new Error('socket hang up at db.internal:5432')
    )
    const variableResponse = buildCopilotServerToolErrorResponse(
      'edit_workflow_variable',
      new Error('Invalid edited workflow variables: Missing removedVariableIds.')
    )

    expect(response).toEqual({
      status: 500,
      body: {
        code: 'server_tool_execution_failed',
        error: 'Server tool execution failed',
        retryable: false,
      },
    })
    expect(response.body.error).not.toContain('db.internal')
    expect(variableResponse.status).toBe(422)
    expect(variableResponse.body.error).toContain('removedVariableIds')
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

  it('returns a structured 422 payload for dashboard layout validation failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_layout',
      createDashboardLayoutValidationError(
        'entityDocument.layout',
        'edit_layout entityDocument requires layout'
      )
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_dashboard_layout_edit',
        retryable: true,
        issues: [
          {
            path: 'entityDocument.layout',
            message: 'edit_layout entityDocument requires layout',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('tg-dashboard-layout-structure-v3')
    expect(response.body.hint).toContain('removedPanelIds')
  })

  it('returns a structured 422 payload for widget config validation failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_widget',
      createWidgetConfigValidationError('colorPair.watchlistId', 'Unknown watchlist id')
    )

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({
        code: 'invalid_widget_config',
        retryable: true,
        issues: [
          {
            path: 'colorPair.watchlistId',
            message: 'Unknown watchlist id',
          },
        ],
      }),
    })
    expect(response.body.hint).toContain('get_widgets_metadata')
  })

  it('passes through structured server tool errors without collapsing them to 500', () => {
    const response = buildCopilotServerToolErrorResponse(
      'search_documentation',
      new StructuredServerToolError({
        status: 503,
        body: {
          code: 'search_documentation_unavailable',
          error: 'Documentation search is unavailable because no embedding provider is configured.',
          hint: 'Configure the OpenAI default API key or Azure OpenAI embedding service to enable documentation search.',
          retryable: false,
        },
      })
    )

    expect(response).toEqual({
      status: 503,
      body: {
        code: 'search_documentation_unavailable',
        error: 'Documentation search is unavailable because no embedding provider is configured.',
        hint: 'Configure the OpenAI default API key or Azure OpenAI embedding service to enable documentation search.',
        retryable: false,
      },
    })
  })
})
