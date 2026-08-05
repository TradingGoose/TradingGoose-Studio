import { describe, expect, it } from 'vitest'
import { matchesWorkflowLogFilters, parseListingFilters, serializeWorkflowLog } from './log-utils'

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
                assetType: 'stock',
                listing: {
                  listing_type: 'default',
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
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
          assetType: 'stock',
          listing: {
            listing_type: 'default',
            listing_id: 'AAPL',
            base_id: '',
            quote_id: '',
          },
        },
      },
    })
    expect(matchesWorkflowLogFilters(log, { assetTypes: ['stock'] })).toBe(true)
    expect(matchesWorkflowLogFilters(log, { assetTypes: ['default'] })).toBe(false)
  })

  it('omits executionData for basic responses and non-record full-detail rows', () => {
    expect(serializeWorkflowLog(buildRow({ executionData: { traceSpans: [] } }), 'basic')).toEqual(
      expect.objectContaining({ executionData: undefined })
    )
    expect(
      serializeWorkflowLog(buildRow({ executionData: ['not', 'a', 'record'] }), 'full')
    ).toEqual(expect.objectContaining({ executionData: undefined }))
  })

  it('exposes only the safe canonical deadline diagnostic in full details', () => {
    const canonicalResult = {
      success: false,
      error: 'Workflow execution time limit exceeded',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      output: { secret: 'do-not-expose' },
      logs: [{ output: { token: 'do-not-expose' } }],
      deadline: {
        appliedTierId: 'tier-1',
        appliedTierName: 'Tier 1',
        limitSeconds: '10',
        processingStartedAt: '2026-05-05T00:00:00.000Z',
        terminatedAt: '2026-05-05T00:00:10.000Z',
        internal: 'do-not-expose',
      },
    }
    const full = serializeWorkflowLog(buildRow({ executionData: { canonicalResult } }), 'full')
    const basic = serializeWorkflowLog(buildRow({ executionData: { canonicalResult } }), 'basic')

    expect(full.executionData?.canonicalResult).toEqual({
      success: false,
      error: 'Workflow execution time limit exceeded',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: {
        appliedTierId: 'tier-1',
        appliedTierName: 'Tier 1',
        limitSeconds: '10',
        processingStartedAt: '2026-05-05T00:00:00.000Z',
        terminatedAt: '2026-05-05T00:00:10.000Z',
      },
    })
    expect(full.executionData?.canonicalResult).not.toHaveProperty('output')
    expect(full.executionData?.canonicalResult?.deadline).not.toHaveProperty('internal')
    expect(basic.executionData).toBeUndefined()
  })

  it('omits malformed and non-deadline canonical results', () => {
    const malformed = serializeWorkflowLog(
      buildRow({
        executionData: {
          canonicalResult: {
            success: false,
            error: 'Workflow execution time limit exceeded',
            code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
            deadline: { appliedTierId: 'tier-1', limitSeconds: '10' },
          },
        },
      }),
      'full'
    )
    const cancellation = serializeWorkflowLog(
      buildRow({
        executionData: {
          canonicalResult: {
            success: false,
            error: 'Workflow execution was cancelled',
            code: 'WORKFLOW_EXECUTION_CANCELLED',
          },
        },
      }),
      'full'
    )

    expect(malformed.executionData?.canonicalResult).toBeUndefined()
    expect(cancellation.executionData?.canonicalResult).toBeUndefined()
  })

  it('derives error outcome from nested trace span children', () => {
    const log = serializeWorkflowLog(
      buildRow({
        executionData: {
          traceSpans: [
            {
              id: 'span-1',
              name: 'Workflow',
              type: 'workflow',
              duration: 250,
              startTime: '2026-05-05T00:00:00.000Z',
              endTime: '2026-05-05T00:00:01.000Z',
              status: 'success',
              children: [
                {
                  id: 'child-span-1',
                  name: 'HTTP',
                  type: 'block',
                  duration: 100,
                  startTime: '2026-05-05T00:00:00.100Z',
                  endTime: '2026-05-05T00:00:00.200Z',
                  status: 'error',
                },
              ],
            },
          ],
        },
      }),
      'full'
    )

    expect(log.outcome).toBe('error')
  })
})

describe('parseListingFilters', () => {
  it('returns null when any JSON array entry is not a valid listing identity', () => {
    expect(parseListingFilters(JSON.stringify([{ listing_type: 'default' }]))).toBeNull()
    expect(
      parseListingFilters(
        JSON.stringify([
          { listing_type: 'default', listing_id: 'AAPL' },
          { listing_type: 'crypto', base_id: 'BTC' },
        ])
      )
    ).toBeNull()
  })

  it('keeps every valid listing identity from JSON arrays', () => {
    expect(
      parseListingFilters(
        JSON.stringify([
          { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
          { listing_type: 'crypto', listing_id: '', base_id: 'BTC', quote_id: 'USD' },
        ])
      )
    ).toEqual([
      { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
      { listing_type: 'crypto', listing_id: '', base_id: 'BTC', quote_id: 'USD' },
    ])
  })
})
