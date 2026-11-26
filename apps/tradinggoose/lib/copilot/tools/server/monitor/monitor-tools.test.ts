import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MONITOR_DOCUMENT_FORMAT } from '@/lib/copilot/document-formats'
import { serializeMonitorDocument } from '@/lib/copilot/monitor/monitor-documents'
import { ToolResultSchemas } from '@/lib/copilot/registry'
import { editMonitorServerTool } from '@/lib/copilot/tools/server/monitor/edit-monitor'
import { listMonitorsServerTool } from '@/lib/copilot/tools/server/monitor/list-monitors'
import { readMonitorServerTool } from '@/lib/copilot/tools/server/monitor/read-monitor'
import type { MonitorRecord } from '@/lib/copilot/tools/server/monitor/shared'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'
import { normalizePortfolioMonitorConfig } from '@/lib/monitors/portfolio-config'
import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import { getMonitorReviewBaseHash, updateMonitorForUser } from '@/app/api/monitors/update-service'

const mocks = vi.hoisted(() => ({
  getMonitorRowById: vi.fn(),
  listMonitorRows: vi.fn(),
  resolveListingIdentities: vi.fn(),
  update: vi.fn(),
  reconcile: vi.fn(),
  workflow: vi.fn(),
  access: vi.fn(),
  verifyWorkspaceContext: vi.fn(),
}))

vi.mock('@/app/api/monitors/shared', async (original) => ({
  ...(await original<typeof import('@/app/api/monitors/shared')>()),
  ensureWorkflowInWorkspace: mocks.workflow,
  ensureMonitorTriggerBlockInDeployedState: vi.fn(),
  ensureTriggerCapableIndicator: vi.fn(),
  getMonitorRowById: mocks.getMonitorRowById,
  listMonitorRows: mocks.listMonitorRows,
}))

vi.mock('@tradinggoose/db', async () => ({
  ...(await import('@tradinggoose/db/schema')),
  db: { update: mocks.update },
}))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: mocks.access }))
vi.mock('@/app/api/monitors/reconcile', () => ({ notifyMonitorsReconcile: mocks.reconcile }))
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
      providerId: 'alpaca',
      providerParams: { feed: 'iex' },
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
  webhook: {
    id: MONITOR_RECORD.monitorId,
    provider: MONITOR_RECORD.source,
    workflowId: MONITOR_RECORD.workflowId,
    blockId: null,
    createdAt: new Date(MONITOR_RECORD.createdAt),
    updatedAt: new Date(MONITOR_RECORD.updatedAt),
    isActive: true,
    providerConfig: {
      triggerId: 'indicator_trigger',
      version: 1,
      monitor: {
        ...MONITOR_RECORD.providerConfig.monitor,
        triggerBlockId: MONITOR_RECORD.blockId,
        auth: {
          encryptedSecrets: { apiKey: 'fixture-key', apiSecret: 'fixture-secret' },
          secretVersion: 1,
        },
      },
    },
  },
  workflow: { id: MONITOR_RECORD.workflowId, workspaceId: 'workspace-1' },
}

const expectIdentityOnlyDocument = (document: string) => {
  const parsed = JSON.parse(document)
  expect(parsed.listing).toEqual(LISTING_IDENTITY)
  expect(parsed.listing).not.toHaveProperty('listingIdentity')
  expect(parsed.listing).not.toHaveProperty('base')
  expect(parsed.listing).not.toHaveProperty('name')
}

describe('Copilot monitor presentation resolution', () => {
  let current = MONITOR_ROW.webhook
  beforeEach(() => {
    vi.clearAllMocks()
    current = structuredClone(MONITOR_ROW.webhook)
    mocks.getMonitorRowById.mockImplementation(async () => ({ ...MONITOR_ROW, webhook: current }))
    mocks.listMonitorRows.mockResolvedValue([MONITOR_ROW, MONITOR_ROW])
    mocks.resolveListingIdentities.mockResolvedValue({
      [getListingIdentityKey(LISTING_IDENTITY)]: RESOLVED_LISTING,
    })
    mocks.access.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mocks.workflow.mockResolvedValue({ isDeployed: true })
    mocks.update.mockReturnValue({
      set: (patch: Partial<typeof current>) => ({
        where: (condition: SQL) => ({
          returning: () => {
            const query = new PgDialect().sqlToQuery(condition)
            expect(query.params.slice(0, 3)).toEqual([
              current.id,
              current.provider,
              current.workflowId,
            ])
            if (query.sql.includes('"is_active" =') && !query.params.includes(current.isActive))
              return []
            if (
              query.sql.includes('"provider_config"::jsonb') &&
              !query.params.includes(JSON.stringify(current.providerConfig))
            )
              return []
            current = { ...current, ...patch }
            return [current]
          },
        }),
      }),
    })
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
    expect(ToolResultSchemas.read_monitor.parse(result)).toMatchObject({
      workspaceId: 'workspace-1',
    })
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
    expect(mocks.update).not.toHaveBeenCalled()
    expect(result.requiresReview).toBe(true)
    expect(ToolResultSchemas.edit_monitor.parse(result)).toMatchObject({
      workspaceId: 'workspace-1',
    })
    expect(result.monitorName).toBe('rsi on AAPL (1m)')
    expectIdentityOnlyDocument(result.monitorDocument)
  })

  it.each([
    'before the writer reads',
    'during configuration preparation',
    'during an activation change',
  ])('preserves an ordinary monitor edit made %s and accepts a fresh review', async (timing) => {
    const args = { monitorId: current.id, monitorDocument: MONITOR_DOCUMENT }
    const context = { userId: 'user-1', accessLevel: 'full' as const }
    const stage = () => editMonitorServerTool.execute(args, { ...context, accessLevel: 'limited' })
    const accept = (acceptedReviewBaseStateHash: string) =>
      editMonitorServerTool.execute(args, { ...context, acceptedReviewBaseStateHash })
    const preview = await stage()
    const editorSave = () =>
      updateMonitorForUser({
        monitorId: current.id,
        userId: 'editor',
        requestId: 'editor',
        logger: { warn: vi.fn() },
        body: {
          workspaceId: 'workspace-1',
          ...(timing === 'during an activation change' ? { isActive: false } : { interval: '5m' }),
        },
      })
    if (timing === 'before the writer reads') {
      mocks.verifyWorkspaceContext.mockImplementationOnce(async () => {
        await editorSave()
        return { userId: 'user-1', workspaceId: 'workspace-1' }
      })
    } else {
      mocks.workflow.mockImplementationOnce(async () => {
        await editorSave()
        return { isDeployed: true }
      })
    }

    await expect(accept(preview.reviewBaseStateHash)).rejects.toMatchObject({
      status: 409,
      code: 'stale_server_tool_review',
    })
    expect(current.providerConfig.monitor.interval).toBe(
      timing === 'during an activation change' ? '1m' : '5m'
    )
    expect(current.isActive).toBe(timing !== 'during an activation change')
    expect(mocks.reconcile).toHaveBeenCalledOnce()
    expect(mocks.access).toHaveBeenCalledWith('workspace-1', 'editor')

    const fresh = await stage()
    await expect(accept(fresh.reviewBaseStateHash)).resolves.toMatchObject({ success: true })
    expect(current.isActive).toBe(true)
    expect(current.providerConfig.monitor.interval).toBe('1m')
    expect(mocks.reconcile).toHaveBeenCalledTimes(2)
  })

  it('keeps a portfolio monitor review valid when only polling progress changes', () => {
    const providerConfig = normalizePortfolioMonitorConfig({
      triggerBlockId: 'block-1',
      providerId: 'robinhood',
      serviceId: 'robinhood',
      credentialId: 'credential-1',
      connectionOwnerUserId: 'editor',
      accountId: 'account-1',
      condition: {
        root: {
          combinator: 'and',
          rules: [{ metric: 'summary.totalPortfolioValue', operator: 'gt', value: 0 }],
        },
      },
    })
    const row = {
      ...MONITOR_ROW.webhook,
      path: 'portfolio',
      provider: PORTFOLIO_MONITOR_PROVIDER,
      providerConfig,
    }
    const reviewed = getMonitorReviewBaseHash(row)
    expect(
      getMonitorReviewBaseHash({
        ...row,
        providerConfig: { ...providerConfig, runtimeState: { wasTrue: true } },
      })
    ).toBe(reviewed)
  })

  it('requires a fresh approval to replace monitor credentials rotated since preview', async () => {
    const args = {
      monitorId: current.id,
      monitorDocument: serializeMonitorDocument({
        ...JSON.parse(MONITOR_DOCUMENT),
        auth: { secrets: { apiKey: 'proposal-key', apiSecret: 'proposal-secret' } },
      }),
    }
    const preview = await editMonitorServerTool.execute(args, {
      userId: 'user-1',
      accessLevel: 'limited',
    })
    expect(preview.preview.documentDiff.before).not.toContain('fixture-secret')
    await updateMonitorForUser({
      monitorId: current.id,
      userId: 'editor',
      requestId: 'editor',
      logger: { warn: vi.fn() },
      body: {
        workspaceId: 'workspace-1',
        auth: { secrets: { apiKey: 'editor-key', apiSecret: 'editor-secret' } },
      },
    })
    const edited = structuredClone(current.providerConfig)
    await expect(
      editMonitorServerTool.execute(args, {
        userId: 'user-1',
        accessLevel: 'full',
        acceptedReviewBaseStateHash: preview.reviewBaseStateHash,
      })
    ).rejects.toMatchObject({ status: 409, code: 'stale_server_tool_review' })
    expect(current.providerConfig).toEqual(edited)
    expect(mocks.reconcile).toHaveBeenCalledOnce()
  })

  it('retains the writer’s workspace authorization on an accepted review', async () => {
    const args = { monitorId: current.id, monitorDocument: MONITOR_DOCUMENT }
    const { reviewBaseStateHash } = await editMonitorServerTool.execute(args, {
      userId: 'user-1',
      accessLevel: 'limited',
    })
    mocks.access.mockResolvedValueOnce({ exists: true, hasAccess: true, canWrite: false })
    await expect(
      editMonitorServerTool.execute(args, {
        userId: 'user-1',
        accessLevel: 'full',
        acceptedReviewBaseStateHash: reviewBaseStateHash,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.reconcile).not.toHaveBeenCalled()
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

    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.resolveListingIdentities).toHaveBeenCalledWith([LISTING_IDENTITY], signal)
    expect(result.success).toBe(true)
    expect(ToolResultSchemas.edit_monitor.parse(result)).toMatchObject({
      workspaceId: 'workspace-1',
    })
    expect(result.monitorName).toBe('rsi on AAPL (1m)')
    expectIdentityOnlyDocument(result.monitorDocument)
  })
})
