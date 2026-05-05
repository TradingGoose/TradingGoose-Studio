import { describe, expect, it } from 'vitest'
import { serializeWorkflowLog } from './log-utils'

const buildRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'log-1',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    level: 'info',
    trigger: 'manual',
    startedAt: new Date('2026-05-05T00:00:00.000Z'),
    endedAt: new Date('2026-05-05T00:00:01.000Z'),
    totalDurationMs: 250,
    executionData: {},
    cost: null,
    files: null,
    createdAt: new Date('2026-05-05T00:00:00.000Z'),
    workflowSummary: null,
    workflowName: 'Workflow',
    workflowDescription: null,
    workflowColor: '#3972F6',
    workflowFolderId: null,
    workflowFolderName: null,
    workflowUserId: 'user-1',
    workflowWorkspaceId: 'workspace-1',
    workflowCreatedAt: new Date('2026-05-04T00:00:00.000Z'),
    workflowUpdatedAt: new Date('2026-05-05T00:00:00.000Z'),
    ...overrides,
  }) as any

describe('serializeWorkflowLog executionData', () => {
  it('does not spread arbitrary stored executionData fields', () => {
    const log = serializeWorkflowLog(
      buildRow({
        executionData: {
          environment: { userId: 'user-1' },
          tokenBreakdown: { total: 100 },
          models: { model: { total: 1 } },
          traceSpans: [
            {
              id: 'span-1',
              name: 'Fetch Bars',
              type: 'block',
              duration: 250,
              startTime: '2026-05-05T00:00:00.000Z',
              endTime: '2026-05-05T00:00:01.000Z',
              status: 'success',
            },
          ],
          finalOutput: 'stored-output',
        },
      }),
      'full'
    )

    const executionData = log.executionData as Record<string, unknown>
    expect(executionData).toMatchObject({
      traceSpans: [
        expect.objectContaining({
          id: 'span-1',
          name: 'Fetch Bars',
        }),
      ],
      finalOutput: 'stored-output',
      enhanced: true,
    })
    expect(executionData).not.toHaveProperty('environment')
    expect(executionData).not.toHaveProperty('tokenBreakdown')
    expect(executionData).not.toHaveProperty('models')
    expect(executionData).not.toHaveProperty('totalDuration')
  })

  it('keeps only the monitor trigger fields used by the monitor UI', () => {
    const log = serializeWorkflowLog(
      buildRow({
        executionData: {
          trigger: {
            source: 'indicator_trigger',
            timestamp: '2026-05-05T00:00:00.000Z',
            data: {
              executionTarget: 'deployed',
              monitor: {
                id: 'monitor-1',
                workflowId: 'workflow-1',
                blockId: 'block-1',
                providerId: 'alpaca',
                interval: '1m',
                indicatorId: 'rsi',
                listing: {
                  listing_type: 'default',
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  assetClass: 'stock',
                  name: 'Apple Inc.',
                },
              },
            },
          },
        },
      }),
      'full'
    )

    expect((log.executionData as Record<string, unknown>).trigger).toEqual({
      source: 'indicator_trigger',
      data: {
        monitor: {
          id: 'monitor-1',
          providerId: 'alpaca',
          interval: '1m',
          indicatorId: 'rsi',
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            assetClass: 'stock',
          },
        },
      },
    })
  })

  it('omits executionData for basic responses and non-record full-detail rows', () => {
    expect(serializeWorkflowLog(buildRow({ executionData: { traceSpans: [] } }), 'basic')).toEqual(
      expect.objectContaining({ executionData: undefined })
    )
    expect(
      serializeWorkflowLog(buildRow({ executionData: ['not', 'a', 'record'] }), 'full')
    ).toEqual(expect.objectContaining({ executionData: undefined }))
  })
})
