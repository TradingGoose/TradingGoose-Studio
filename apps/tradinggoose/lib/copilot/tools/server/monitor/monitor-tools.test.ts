import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MONITOR_DOCUMENT_FORMAT,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import { editMonitorServerTool } from '@/lib/copilot/tools/server/monitor/edit-monitor'
import { listMonitorsServerTool } from '@/lib/copilot/tools/server/monitor/list-monitors'
import { readMonitorServerTool } from '@/lib/copilot/tools/server/monitor/read-monitor'
import type { MonitorRecord } from '@/lib/copilot/tools/server/monitor/shared'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'
import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'

const mocks = vi.hoisted(() => ({
  getMonitorRowById: vi.fn(),
  listMonitorRows: vi.fn(),
  resolveListingIdentities: vi.fn(),
  toMonitorRecord: vi.fn(),
  updateMonitorForUser: vi.fn(),
  verifyWorkspaceContext: vi.fn(),
}))

vi.mock('@/app/api/monitors/shared', () => ({
  getMonitorRowById: mocks.getMonitorRowById,
  listMonitorRows: mocks.listMonitorRows,
  toMonitorRecord: mocks.toMonitorRecord,
}))

vi.mock('@/app/api/monitors/update-service', () => ({
  updateMonitorForUser: mocks.updateMonitorForUser,
}))

vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifyWorkspaceContext: mocks.verifyWorkspaceContext,
}))

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentities: mocks.resolveListingIdentities,
}))

const LISTING_IDENTITY = {
  listing_id: 'TG_LSTG_61E9AA',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
} satisfies ListingIdentity

const RESOLVED_LISTING = {
  listingIdentity: LISTING_IDENTITY,
  base: 'AAPL',
  quote: 'USD',
  name: 'Apple Inc.',
  assetClass: 'stock',
} satisfies ListingResolved

const MONITOR_RECORD = {
  monitorId: 'monitor-1',
  source: INDICATOR_MONITOR_PROVIDER,
  workflowId: 'workflow-1',
  blockId: 'block-1',
  isActive: true,
  providerConfig: {
    monitor: {
      providerId: 'polygon',
      interval: '1m',
      listing: LISTING_IDENTITY,
      indicatorId: 'rsi',
    },
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies MonitorRecord

const MONITOR_DOCUMENT = serializeMonitorDocument({
  source: INDICATOR_MONITOR_PROVIDER,
  workflowId: MONITOR_RECORD.workflowId,
  blockId: MONITOR_RECORD.blockId,
  providerId: MONITOR_RECORD.providerConfig.monitor.providerId,
  interval: MONITOR_RECORD.providerConfig.monitor.interval,
  indicatorId: MONITOR_RECORD.providerConfig.monitor.indicatorId,
  listing: LISTING_IDENTITY,
  isActive: MONITOR_RECORD.isActive,
})

const MONITOR_ROW = {
  webhook: { id: MONITOR_RECORD.monitorId },
  workflow: { workspaceId: 'workspace-1' },
}

const expectIdentityOnlyDocument = (document: string) => {
  const parsed = JSON.parse(document)
  expect(parsed.listing).toEqual(LISTING_IDENTITY)
  expect(parsed.listing).not.toHaveProperty('listingIdentity')
  expect(parsed.listing).not.toHaveProperty('base')
  expect(parsed.listing).not.toHaveProperty('name')
}

describe('Copilot monitor presentation resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMonitorRowById.mockResolvedValue(MONITOR_ROW)
    mocks.listMonitorRows.mockResolvedValue([MONITOR_ROW, MONITOR_ROW])
    mocks.resolveListingIdentities.mockResolvedValue({
      [getListingIdentityKey(LISTING_IDENTITY)]: RESOLVED_LISTING,
    })
    mocks.toMonitorRecord.mockResolvedValue(MONITOR_RECORD)
    mocks.updateMonitorForUser.mockResolvedValue(MONITOR_RECORD)
    mocks.verifyWorkspaceContext.mockResolvedValue({
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
  })

  it('batch-resolves list entry names without enriching monitor records', async () => {
    const signal = new AbortController().signal
    const result = await listMonitorsServerTool.execute(
      { workspaceId: 'workspace-1' },
      { userId: 'user-1', signal }
    )

    expect(mocks.resolveListingIdentities).toHaveBeenCalledTimes(1)
    expect(mocks.resolveListingIdentities).toHaveBeenCalledWith(
      [LISTING_IDENTITY, LISTING_IDENTITY],
      signal
    )
    expect(result.monitors.map((monitor: { monitorName: string }) => monitor.monitorName)).toEqual([
      'rsi on AAPL (1m)',
      'rsi on AAPL (1m)',
    ])
  })

  it('resolves read envelope names while serializing only the identity', async () => {
    const signal = new AbortController().signal
    const result = await readMonitorServerTool.execute(
      { monitorId: MONITOR_RECORD.monitorId },
      { userId: 'user-1', signal }
    )

    expect(mocks.resolveListingIdentities).toHaveBeenCalledWith([LISTING_IDENTITY], signal)
    expect(result.monitorName).toBe('rsi on AAPL (1m)')
    expectIdentityOnlyDocument(result.monitorDocument)
  })

  it('resolves the staged edit document name without enriching the review document', async () => {
    const signal = new AbortController().signal
    const result = await editMonitorServerTool.execute(
      {
        monitorId: MONITOR_RECORD.monitorId,
        monitorDocument: MONITOR_DOCUMENT,
        documentFormat: MONITOR_DOCUMENT_FORMAT,
      },
      { userId: 'user-1', accessLevel: 'limited', signal }
    )

    expect(mocks.resolveListingIdentities).toHaveBeenCalledWith([LISTING_IDENTITY], signal)
    expect(mocks.updateMonitorForUser).not.toHaveBeenCalled()
    expect(result.requiresReview).toBe(true)
    expect(result.monitorName).toBe('rsi on AAPL (1m)')
    expectIdentityOnlyDocument(result.monitorDocument)
  })

  it('resolves the accepted edit response name after updating the monitor', async () => {
    const signal = new AbortController().signal
    const result = await editMonitorServerTool.execute(
      {
        monitorId: MONITOR_RECORD.monitorId,
        monitorDocument: MONITOR_DOCUMENT,
        documentFormat: MONITOR_DOCUMENT_FORMAT,
      },
      { userId: 'user-1', accessLevel: 'full', signal }
    )

    expect(mocks.updateMonitorForUser).toHaveBeenCalledTimes(1)
    expect(mocks.resolveListingIdentities).toHaveBeenCalledWith([LISTING_IDENTITY], signal)
    expect(result.success).toBe(true)
    expect(result.monitorName).toBe('rsi on AAPL (1m)')
    expectIdentityOnlyDocument(result.monitorDocument)
  })
})
