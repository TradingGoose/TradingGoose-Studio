import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildCopilotServerToolErrorResponse } from '@/lib/copilot/server-tool-errors'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
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

  it('falls back to a generic 500 payload for non-structured failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'edit_watchlist',
      new WatchlistDocumentError('Persisted watchlist is corrupt')
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
    expect(response.body.error).not.toContain('corrupt')
    expect(variableResponse.status).toBe(422)
    expect(variableResponse.body.error).toContain('removedVariableIds')
  })

  it('returns a structured 422 payload for tool argument schema failures', () => {
    const response = buildCopilotServerToolErrorResponse(
      'make_api_request',
      // Zod 4 issue shapes: `invalid_type` dropped `received`, and
      // `invalid_enum_value` became `invalid_value` carrying `values`.
      new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          input: undefined,
          path: ['url'],
          message: 'Required',
        },
        {
          code: 'invalid_value',
          values: ['GET', 'POST', 'PUT'],
          input: 'get',
          path: ['method'],
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

  it.each([
    [
      'dashboard layout',
      'edit_layout',
      createDashboardLayoutValidationError(
        'entityDocument.layout',
        'edit_layout entityDocument requires layout'
      ),
      'invalid_dashboard_layout_edit',
      'tg-dashboard-layout-structure-v3',
    ],
    [
      'widget config',
      'edit_widget',
      createWidgetConfigValidationError('colorPair.watchlistId', 'Unknown watchlist id'),
      'invalid_widget_config',
      'get_widgets_metadata',
    ],
  ])('returns a structured 422 payload for %s failures', (_, toolName, error, code, hint) => {
    const response = buildCopilotServerToolErrorResponse(toolName, error)

    expect(response).toEqual({
      status: 422,
      body: expect.objectContaining({ code, retryable: true, issues: error.issues }),
    })
    expect(response.body.hint).toContain(hint)
  })
})
