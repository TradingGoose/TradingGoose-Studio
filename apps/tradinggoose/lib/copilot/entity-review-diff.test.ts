import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  buildEntityReviewDiffLines,
  buildEntityReviewDiffPayload,
} from './entity-review-diff'

describe('entity-review-diff', () => {
  it('builds skill diffs from pending edit requests', () => {
    const payload = buildEntityReviewDiffPayload(
      {
        id: 'tool-skill',
        name: 'manage_skill',
        state: ClientToolCallState.pending,
        params: {
          operation: 'edit',
          name: 'Updated skill',
          content: 'New instructions',
        },
      },
      {
        name: 'Original skill',
        description: 'Original description',
        content: 'Original instructions',
      }
    )

    expect(payload?.title).toBe('Proposed Skill Changes')
    expect(payload?.sections).toEqual([
      {
        key: 'name',
        label: 'Name',
        before: 'Original skill',
        after: 'Updated skill',
      },
      {
        key: 'content',
        label: 'Instructions',
        before: 'Original instructions',
        after: 'New instructions',
      },
    ])
  })

  it('mirrors custom-tool schema renames when only the title changes', () => {
    const payload = buildEntityReviewDiffPayload(
      {
        id: 'tool-custom-tool',
        name: 'manage_custom_tool',
        state: ClientToolCallState.pending,
        params: {
          operation: 'edit',
          title: 'new_tool_name',
        },
      },
      {
        title: 'old_tool_name',
        schemaText: JSON.stringify(
          {
            type: 'function',
            function: {
              name: 'old_tool_name',
              parameters: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          },
          null,
          2
        ),
        codeText: 'return 1',
      }
    )

    expect(payload?.sections.find((section) => section.key === 'title')?.after).toBe('new_tool_name')
    expect(payload?.sections.find((section) => section.key === 'schemaText')?.after).toContain(
      '"name": "new_tool_name"'
    )
  })

  it('builds indicator diffs for editable fields', () => {
    const payload = buildEntityReviewDiffPayload(
      {
        id: 'tool-indicator',
        name: 'manage_indicator',
        state: ClientToolCallState.pending,
        params: {
          operation: 'edit',
          color: '#22c55e',
          inputMeta: { period: 20 },
        },
      },
      {
        name: 'RSI',
        color: '#ef4444',
        pineCode: 'plot(close)',
        inputMeta: { period: 14 },
      }
    )

    expect(payload?.title).toBe('Proposed Indicator Changes')
    expect(payload?.sections).toEqual([
      {
        key: 'color',
        label: 'Color',
        before: '#ef4444',
        after: '#22c55e',
      },
      {
        key: 'inputMeta',
        label: 'Input Meta',
        before: JSON.stringify({ period: 14 }, null, 2),
        after: JSON.stringify({ period: 20 }, null, 2),
      },
    ])
  })

  it('includes MCP defaults that are applied during add operations', () => {
    const payload = buildEntityReviewDiffPayload(
      {
        id: 'tool-mcp',
        name: 'manage_mcp_tool',
        state: ClientToolCallState.pending,
        params: {
          operation: 'add',
          config: {
            name: 'Market Data',
          },
        },
      },
      {
        name: '',
        description: '',
        transport: 'http',
        url: '',
        headers: {},
        command: '',
        args: [],
        env: {},
        timeout: 30000,
        retries: 3,
        enabled: true,
      }
    )

    expect(payload?.title).toBe('Proposed MCP Server Changes')
    expect(payload?.sections).toEqual([
      {
        key: 'name',
        label: 'Name',
        before: '',
        after: 'Market Data',
      },
      {
        key: 'transport',
        label: 'Transport',
        before: 'http',
        after: 'streamable-http',
      },
    ])
  })

  it('omits synthetic empty removed lines when diffing from an empty value', () => {
    expect(buildEntityReviewDiffLines('', 'line one\nline two')).toEqual([
      { type: 'added', text: 'line one' },
      { type: 'added', text: 'line two' },
    ])
  })
})
