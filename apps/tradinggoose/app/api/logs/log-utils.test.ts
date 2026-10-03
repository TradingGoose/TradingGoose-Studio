import { describe, expect, it } from 'vitest'
import {
  deriveWorkflowLogOutcome,
  matchesWorkflowLogFilters,
  parseListingFilters,
  serializeWorkflowLog,
} from './log-utils'

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
          checkpoint: {
            revision: 3,
            encryptedSnapshot: 'private-encrypted-checkpoint',
            pausePoints: [{ id: 'private-point' }],
            activeJobId: null,
          },
          pause: { url: '/review/execution-1', revision: 3 },
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
          errorMessage: 'Workflow cancelled',
          blockExecutions: [{ errorMessage: 'legacy error' }],
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
      errorMessage: 'Workflow cancelled',
    })
    expect(executionData).not.toHaveProperty('environment')
    expect(executionData).not.toHaveProperty('blockExecutions')
    expect(executionData).not.toHaveProperty('checkpoint')
    expect(executionData).not.toHaveProperty('pause')
    expect(JSON.stringify(log)).not.toContain('private-encrypted-checkpoint')
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

  it('keeps a recovered workflow successful despite errors in its real trace', () => {
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

    expect(log.outcome).toBe('success')
    expect(log.executionData?.traceSpans?.[0].children?.[0].status).toBe('error')
  })

  it.each([[], [{ status: 'success' }], [{ status: 'error' }]])(
    'keeps terminal failures authoritative over trace statuses %j',
    (...traceSpans) => {
      const row = buildRow({ level: 'error', executionData: { traceSpans } })
      expect(deriveWorkflowLogOutcome(row)).toBe('error')
      expect(deriveWorkflowLogOutcome({ ...row, endedAt: null })).toBe('running')
      expect(deriveWorkflowLogOutcome({ ...row, level: 'info' })).toBe('success')
      expect(deriveWorkflowLogOutcome({ ...row, level: 'info', endedAt: null })).toBe('running')
    }
  )
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
