// @vitest-environment jsdom

import { act, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { NextRequest } from 'next/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatWebhookInput } from '@/lib/webhooks/utils'
import {
  createTeamsSubscription,
  createTelegramWebhook,
  createWebflowWebhookSubscription,
  deleteTeamsWebhook,
  deleteWebflowWebhook,
  getAirtableDeclarativeProviderConfig,
  getExternalSubscriptionCredentialIds,
  getWebhookRevision,
  getWebhookSnapshotRevision,
  isMicrosoftTeamsChatCallbackPath,
  processAirtableWebhookCleanup,
  sweepAirtableWebhookCleanup,
  toPublicAirtableWebhook,
  WebhookRevisionConflictError,
} from '@/lib/webhooks/webhook-helpers'
import { EnvironmentVariables } from '@/app/workspace/[workspaceId]/environment/components/environment-variables'
import { executeWebhookJob } from '@/background/webhook-execution'
import { useWebhookManagement } from '@/hooks/use-webhook-management'
import { PUT as putPersonal } from './environment/route'
import { DELETE as deleteWebhook, PATCH as patchWebhook } from './webhooks/[id]/route'
import { GET as getWebhooks, POST as postWebhook } from './webhooks/route'
import { PUT as putWorkspace } from './workspaces/[id]/environment/route'

type Row = Record<string, any>
type Where = (row: Row) => boolean
const {
  state,
  fetchMock,
  tokenMock,
  environmentSaveMock,
  environmentDeleteMock,
  workspaceEnvironmentMock,
  personalEnvironmentMock,
  enqueueExecutionMock,
  loadBlueprintMock,
  runWorkflowMock,
  loggingCompleteMock,
  loggingFailureMock,
  tables,
} = vi.hoisted(() => {
  const table = () => new Proxy({}, { get: (_target, key) => String(key) })
  return {
    state: {
      databaseNow: 60_000,
      webhooks: [] as Row[],
      environment: [] as Row[],
      pendingExecutions: [] as Row[],
      workflowExecutionLogs: [] as Row[],
    },
    fetchMock: vi.fn(),
    tokenMock: vi.fn(),
    environmentSaveMock: vi.fn(),
    environmentDeleteMock: vi.fn(),
    workspaceEnvironmentMock: vi.fn(),
    personalEnvironmentMock: vi.fn(),
    enqueueExecutionMock: vi.fn(),
    loadBlueprintMock: vi.fn(),
    runWorkflowMock: vi.fn(),
    loggingCompleteMock: vi.fn(),
    loggingFailureMock: vi.fn(),
    tables: {
      credential: table(),
      environmentVariables: table(),
      pendingExecution: table(),
      webhook: table(),
      workflow: table(),
      workflowExecutionLogs: table(),
    },
  }
})
vi.mock('@tradinggoose/db/schema', () => tables)
vi.mock('@tradinggoose/db', () => {
  const violation = (constraint: string) =>
    Object.assign(new Error('duplicate'), { code: '23505', constraint_name: constraint })
  const updateEnvironment = async (values: Row, where: Where) => {
    const source = state.environment.find(where)
    if (!source) return []
    const owner = source.userId ? 'user' : 'workspace'
    const collision = state.environment.some(
      (row) =>
        row !== source && row.key === values.key && row[`${owner}Id`] === source[`${owner}Id`]
    )
    if (collision) {
      const cause = violation(`environment_variables_${owner}_key_unique`)
      throw source.workspaceId ? new Error('query failed', { cause }) : cause
    }
    Object.assign(source, values)
    return [{ ...source }]
  }
  const updateWebhooks = async (values: Row, where: Where) => {
    const rows = state.webhooks.filter(where)
    for (const row of rows) {
      const previous = { ...row }
      Object.assign(row, values)
      if (typeof values.providerConfig === 'function')
        row.providerConfig = values.providerConfig(previous)
      if (typeof values.updatedAt === 'function') row.updatedAt = values.updatedAt(previous)
    }
    return rows.map((row) => ({ ...row }))
  }
  const updatePendingExecutions = async (values: Row, where: Where) => {
    const rows = state.pendingExecutions.filter(where)
    for (const row of rows) Object.assign(row, values)
    return rows.map((row) => ({ ...row }))
  }
  const returning = (run: (where: Where) => Row[] | Promise<Row[]>) => ({
    where: (where: Where) => ({ returning: () => run(where) }),
  })
  const selectable = (rows: Row[]) => {
    const selection = {
      for: () => selection,
      limit: async (limit: number) => rows.slice(0, limit),
      orderBy: async () => rows,
      then: (resolve: (value: Row[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    }
    return selection
  }
  const webhookRows = () =>
    state.webhooks.map((webhook) => ({
      webhook: { ...webhook },
      workflow: {
        id: webhook.workflowId ?? 'workflow-1',
        name: 'Workflow',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }))
  const database: Row = {
    select: vi.fn(() => ({
      from: (selectedTable: unknown) => ({
        innerJoin: () => ({ where: () => selectable(webhookRows()) }),
        where: (where: Where) =>
          selectable(
            selectedTable === tables.workflow
              ? [{ id: 'workflow-1', userId: 'user-1', workspaceId: 'workspace-1' }].filter(where)
              : selectedTable === tables.credential
                ? [{ id: 'credential-1' }, { id: 'old' }, { id: 'credential-2' }].filter(where)
                : selectedTable === tables.workflowExecutionLogs
                  ? state.workflowExecutionLogs.filter(where).map((entry) => ({ ...entry }))
                  : selectedTable === tables.pendingExecution
                    ? state.pendingExecutions.filter(where).map((entry) => ({ ...entry }))
                    : state.webhooks.filter(where).map((entry) => ({ ...entry }))
          ),
      }),
    })),
    insert: vi.fn(() => ({
      values: (values: Row) => ({
        onConflictDoUpdate: async ({ set }: { set: Row }) => {
          const row = state.environment.find((entry) =>
            ['key', 'userId', 'workspaceId'].every((key) => entry[key] === values[key])
          )
          row ? Object.assign(row, set) : state.environment.push({ ...values })
        },
        returning: async () => {
          state.webhooks.push({ ...values })
          return [{ ...values }]
        },
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Row) =>
        returning((where) =>
          table === tables.environmentVariables
            ? updateEnvironment(values, where)
            : table === tables.pendingExecution
              ? updatePendingExecutions(values, where)
              : updateWebhooks(values, where)
        ),
    })),
    delete: vi.fn(() =>
      returning((where) => {
        const deleted = state.webhooks.filter(where)
        state.webhooks = state.webhooks.filter((row) => !where(row))
        return deleted
      })
    ),
    execute: vi.fn().mockResolvedValue([]),
  }
  database.transaction = async (run: (tx: Row) => Promise<unknown>) => {
    const beforeWebhooks = structuredClone(state.webhooks)
    const beforePendingExecutions = structuredClone(state.pendingExecutions)
    return run(database).catch((error) => {
      state.webhooks = beforeWebhooks
      state.pendingExecutions = beforePendingExecutions
      throw error
    })
  }
  return { db: database }
})
vi.mock('drizzle-orm', () => ({
  and:
    (...predicates: Where[]) =>
    (row: Row) =>
      predicates.every((predicate) => predicate(row)),
  desc: (field: string) => field,
  eq: (field: string, value: unknown) => (row: Row) => {
    const actual = row[field]
    return actual instanceof Date && value instanceof Date
      ? actual.getTime() === value.getTime()
      : actual === value
  },
  inArray: (field: string, values: unknown[]) => (row: Row) => values.includes(row[field]),
  isNull: (field: string) => (row: Row) => row[field] === null,
  sql: (strings: TemplateStringsArray, ...values: any[]) => {
    const expression = strings.join('')
    if (expression.includes("->>'externalId'")) {
      return (row: Row) => row.providerConfig?.externalId === values.at(-1)
    }
    if (expression.includes("->>'externalWebhookCursor'")) {
      const expected = values.at(-1)
      return (row: Row) => {
        const cursor = row.providerConfig?.externalWebhookCursor
        return (cursor == null ? null : String(cursor)) === expected
      }
    }
    if (expression.includes('externalWebhookCursor')) {
      const cursor = values.find((value) => typeof value === 'number')
      return (row: Row) => ({ ...row.providerConfig, externalWebhookCursor: cursor })
    }
    if (expression.includes('greatest')) {
      return (row: Row) => new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1))
    }
    if (expression.includes('jsonb_set')) {
      const config = JSON.parse(values[0])
      config.airtableLifecycle.expiresAt = state.databaseNow + 60_000
      return () => config
    }
    return (row: Row) =>
      expression.includes('expiresAt')
        ? row.providerConfig?.airtableLifecycle?.expiresAt <= state.databaseNow
        : row.providerConfig?.airtableLifecycle?.owner === values.at(-1)
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/environment/api', () => ({
  deleteEnvironmentVariable: environmentDeleteMock,
  fetchPersonalEnvironment: personalEnvironmentMock,
  fetchWorkspaceEnvironment: workspaceEnvironmentMock,
  saveEnvironmentVariable: environmentSaveMock,
}))
vi.mock('@/lib/credentials/oauth', () => ({
  getOAuthAccessTokenForStoredCredential: tokenMock,
  getOAuthAccessTokenForUserCredential: tokenMock,
  resolveOAuthCredentialAccountForUser: vi.fn().mockResolvedValue({ id: 'credential-1' }),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}))
vi.mock('@/lib/execution/pending-execution', () => ({
  enqueuePendingExecution: enqueueExecutionMock,
}))
vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    complete = loggingCompleteMock
    completeWithError = loggingFailureMock
    start = vi.fn().mockResolvedValue('log-1')
  },
}))
vi.mock('@/lib/permissions/utils', () => ({ getUserEntityPermissions: () => 'write' }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: vi.fn(() => 'https://studio.example.test') }))
vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils')>()),
  generateRequestId: vi.fn(() => 'request-1'),
}))
vi.mock('@/lib/utils-server', () => ({
  decryptSecret: vi.fn(async (value: string) => ({ decrypted: value })),
  encryptSecret: vi.fn(async (value: string) => ({ encrypted: value })),
}))
vi.mock('@/lib/workflows/execution-runner', () => ({
  loadWorkflowExecutionBlueprint: loadBlueprintMock,
  runPreparedWorkflowExecution: runWorkflowMock,
}))
vi.mock('@trigger.dev/sdk', () => ({
  schedules: { task: vi.fn((definition) => definition) },
}))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useSubBlockValue: (_blockId: string, subBlockId: string) =>
    subBlockId === 'webhookId' ? 'webhook-1' : null,
  useWorkflowBlocks: () => ({
    'block-1': {
      type: 'generic_webhook',
      triggerMode: true,
      subBlocks: {
        selectedTriggerId: { value: 'generic_webhook' },
        webhookId: { value: 'webhook-1' },
        triggerCredentials: { value: null },
      },
    },
  }),
  useWorkflowMutations: () => ({
    setSubBlockValue: vi.fn(),
    batchSetSubBlockValues: vi.fn(),
  }),
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => ({ workflowId: 'workflow-1' }),
}))
const config = { baseId: 'base-1', tableId: 'table-1', credentialId: 'credential-1' }
const oldConfig = { ...config, credentialId: 'old', externalId: 'existing-remote' }
const previous = { blockId: 'old', provider: 'airtable', providerConfig: oldConfig, isActive: true }
const cleanupScope = { userId: 'user-1' }
const provisioningLifecycle = (previous: Row | null) => ({
  phase: 'provisioning',
  previous,
  emptyObservations: 0,
  expiresAt: 0,
})
const provisioning = (prior: Row | null = null): Row => ({
  id: 'webhook-1',
  path: 'block-1',
  provider: 'airtable',
  providerConfig: {
    ...config,
    airtableLifecycle: provisioningLifecycle(prior),
  },
  isActive: false,
  updatedAt: new Date(0),
})
const remote = (id = 'remote') => ({
  id,
  notificationUrl: 'https://studio.example.test/api/webhooks/trigger/block-1',
  specification: {
    options: { filters: { dataTypes: ['tableData'], recordChangeScope: 'table-1' } },
  },
})
const notificationlessRemote = (id = 'notificationless') => ({
  ...remote(id),
  notificationUrl: null,
})
const webhookConfig = () => state.webhooks[0].providerConfig
const emptyObservations = () => webhookConfig().airtableLifecycle.emptyObservations
const cleanupFixture = (lifecycle: (target: Row) => Row) => {
  const target = { ...config, externalId: 'remote' }
  return {
    ...provisioning(),
    providerConfig: {
      ...config,
      airtablePendingCleanup: [target],
      airtableLifecycle: lifecycle(target),
    },
  }
}
const sweep = async (webhooks: unknown[], deleteStatus?: number) => {
  state.databaseNow += 60_000
  state.webhooks[0].updatedAt = new Date(0)
  if (!deleteStatus || !webhookConfig().airtablePendingCleanup)
    fetchMock.mockResolvedValueOnce(Response.json({ webhooks }))
  if (deleteStatus) fetchMock.mockResolvedValueOnce(new Response(null, { status: deleteStatus }))
  await sweepAirtableWebhookCleanup('sweep')
}
describe('Airtable provisioning reconciliation', () => {
  beforeEach(() => {
    state.databaseNow = 60_000
    state.webhooks = []
    fetchMock.mockReset()
    tokenMock.mockReset()
    tokenMock.mockImplementation(({ credentialId }: { credentialId: string }) => credentialId)
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('keeps provider runtime state outside declarative comparison and public responses', () => {
    const runtimeConfig = {
      ...config,
      externalId: 'remote',
      externalWebhookCursor: 42,
      airtablePendingCleanup: [oldConfig],
      airtableLifecycle: provisioningLifecycle(null),
    }
    expect(getAirtableDeclarativeProviderConfig(runtimeConfig)).toEqual(config)
    expect(
      toPublicAirtableWebhook({ provider: 'airtable', providerConfig: runtimeConfig })
    ).toEqual({
      provider: 'airtable',
      providerConfig: config,
    })
  })
  it('cleans a late remote and recovers only after two later empty observations', async () => {
    state.webhooks = [provisioning()]
    await sweep([])
    expect(emptyObservations()).toBe(1)
    await sweep([notificationlessRemote(), remote()], 503)
    expect(webhookConfig().airtablePendingCleanup).toHaveLength(1)
    await sweep([], 204)
    expect(emptyObservations()).toBe(0)
    expect(webhookConfig()).not.toHaveProperty('airtablePendingCleanup')
    await sweep([notificationlessRemote()])
    await sweep([notificationlessRemote('notificationless-2')])
    expect(state.webhooks).toEqual([])
  })
  it('does not count provider, auth, transport, or malformed list results', async () => {
    state.webhooks = [provisioning()]
    const failures = [
      () => fetchMock.mockResolvedValueOnce(Response.json({})),
      () => fetchMock.mockResolvedValueOnce(Response.json({ webhooks: [{}] })),
      () => fetchMock.mockResolvedValueOnce(Response.json({ webhooks: [remote(' ')] })),
      () => fetchMock.mockResolvedValueOnce(new Response('{')),
      () => fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 })),
      () => fetchMock.mockRejectedValueOnce(new Error('offline')),
      () => tokenMock.mockResolvedValueOnce(null),
    ]
    for (const fail of failures) {
      state.webhooks[0].updatedAt = new Date(0)
      fail()
      await sweepAirtableWebhookCleanup('unknown')
      expect(emptyObservations()).toBe(0)
    }
  })
  it('performs no deletion when concurrent adoption wins the database fence', async () => {
    state.webhooks = [provisioning()]
    fetchMock.mockImplementationOnce(async () => {
      state.webhooks[0] = {
        ...state.webhooks[0],
        providerConfig: { ...config, externalId: 'remote' },
        isActive: true,
        updatedAt: new Date(1),
      }
      return Response.json({ webhooks: [remote()] })
    })
    await sweepAirtableWebhookCleanup('adopted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.webhooks[0].isActive).toBe(true)
    expect(webhookConfig().externalId).toBe('remote')
  })
  it('leases cleanup so concurrent workers issue one remote delete', async () => {
    state.webhooks = [cleanupFixture(() => ({ phase: 'deleting' }))]
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const snapshot = { ...state.webhooks[0] } as any
    const results = await Promise.all([
      processAirtableWebhookCleanup(snapshot, 'first', cleanupScope),
      processAirtableWebhookCleanup(snapshot, 'second', cleanupScope),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results.filter((result) => result.cleaned)).toHaveLength(1)
    expect(state.webhooks).toEqual([])
  })
  it('recovers an expired cleanup lease without stealing an active lease', async () => {
    state.webhooks = [
      cleanupFixture((target) => ({
        phase: 'cleanup',
        owner: 'old',
        target,
        expiresAt: state.databaseNow + 60_000,
        resume: { phase: 'deleting' },
      })),
    ]
    await processAirtableWebhookCleanup({ ...state.webhooks[0] } as any, 'active', cleanupScope)
    expect(fetchMock).not.toHaveBeenCalled()
    state.databaseNow += 60_000
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const result = await processAirtableWebhookCleanup(
      structuredClone(state.webhooks[0]) as any,
      'expired',
      cleanupScope
    )
    expect(result.cleaned).toBe(true)
    expect(state.webhooks).toEqual([])
  })
  it('requires a later eligible sweep to confirm an empty observation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(9_000_000)
    state.webhooks = [provisioning()]
    state.webhooks[0].providerConfig.airtableLifecycle.expiresAt = state.databaseNow + 60_000
    fetchMock.mockImplementation(async () => Response.json({ webhooks: [] }))
    await sweepAirtableWebhookCleanup('first')
    expect(fetchMock).not.toHaveBeenCalled()
    state.databaseNow += 60_000
    await sweepAirtableWebhookCleanup('confirmed')
    expect(webhookConfig().airtableLifecycle.expiresAt).toBe(state.databaseNow + 60_000)
    await sweepAirtableWebhookCleanup('too-soon')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    state.databaseNow += 60_000
    await sweepAirtableWebhookCleanup('second')
    expect(state.webhooks).toEqual([])
  })
  it('uses base plus external ID across credential rotation and restores previous state', async () => {
    state.webhooks = [provisioning(previous)]
    await sweep([notificationlessRemote(), remote('existing-remote')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(emptyObservations()).toBe(1)
    expect(webhookConfig()).not.toHaveProperty('airtablePendingCleanup')
    await sweep([notificationlessRemote('notificationless-2')])
    expect(state.webhooks[0]).toMatchObject({ isActive: true, providerConfig: oldConfig })
  })
  it('resumes an Airtable deletion after its credential becomes usable again', async () => {
    state.webhooks = [
      {
        ...provisioning(),
        workflowId: 'workflow-1',
        blockId: 'block-1',
        providerConfig: { ...config, externalId: 'remote' },
        isActive: true,
      },
    ]
    tokenMock.mockResolvedValueOnce(null)
    const params = { params: Promise.resolve({ id: 'webhook-1' }) }
    expect((await deleteWebhook({ json: async () => ({}) } as NextRequest, params)).status).toBe(
      500
    )
    expect(state.webhooks[0].providerConfig.airtableLifecycle.phase).toBe('deleting')

    tokenMock.mockResolvedValueOnce('token')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await deleteWebhook({ json: async () => ({}) } as NextRequest, params)).status).toBe(
      200
    )
    expect(state.webhooks).toEqual([])
  })
})

describe('Airtable payload durability', () => {
  const airtableWebhook = (): Row => ({
    id: 'webhook-1',
    workflowId: 'workflow-1',
    blockId: 'block-1',
    path: 'airtable-path',
    provider: 'airtable',
    providerConfig: { ...config, externalId: 'remote' },
    isActive: true,
    updatedAt: new Date(0),
  })
  const pending = (id: string): Row => ({
    id,
    executionType: 'webhook',
    status: 'processing',
    payload: {
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      provider: 'airtable',
      blockId: 'block-1',
    },
    updatedAt: new Date(0),
  })
  const page = (payloads: unknown[], cursor: number, mightHaveMore: boolean) =>
    Response.json({ payloads, cursor, mightHaveMore })
  const interruptedPage = () =>
    new Response(
      new ReadableStream({
        start: (controller) => controller.error(new Error('stream interrupted')),
      })
    )
  const retryableFailure = () => new Response(null, { status: 503 })
  const poll = (snapshot: Row, executionId: string) =>
    formatWebhookInput(
      snapshot,
      { id: 'workflow-1', workspaceId: 'workspace-1' },
      {},
      {} as NextRequest,
      executionId,
      executionId
    )
  const execute = (overrides: Row = {}) =>
    executeWebhookJob({
      ...pending('execution-a').payload,
      executionId: 'execution-a',
      ...overrides,
    } as any)
  const queueTenPages = (payloads: unknown[] = [{ id: 'change' }]) => {
    state.pendingExecutions = [pending('execution-a')]
    fetchMock.mockImplementation(() => page(payloads, fetchMock.mock.calls.length, true))
  }

  beforeEach(() => {
    state.webhooks = [airtableWebhook()]
    state.pendingExecutions = [pending('execution-a'), pending('execution-b')]
    state.workflowExecutionLogs = []
    tokenMock.mockResolvedValue('token')
    fetchMock.mockReset()
    enqueueExecutionMock.mockReset().mockResolvedValue(undefined)
    loadBlueprintMock.mockReset().mockResolvedValue({
      workflowContext: { workspaceId: 'workspace-1' },
      workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
    })
    runWorkflowMock.mockReset()
    loggingCompleteMock.mockReset().mockResolvedValue(undefined)
    loggingFailureMock.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns each execution owned pages when a competing poll wins the next cursor', async () => {
    let releaseCompetingPage!: (response: Response) => void
    const delayedPage = new Promise<Response>((resolve) => {
      releaseCompetingPage = resolve
    })
    fetchMock.mockImplementation(() => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(page([{ id: 'P1' }], 1, true))
      }
      if (fetchMock.mock.calls.length === 2) return delayedPage
      return Promise.resolve(page([{ id: 'P2' }], 2, false))
    })

    const firstPoll = poll(structuredClone(state.webhooks[0]), 'execution-a')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondResult = await poll(structuredClone(state.webhooks[0]), 'execution-b')
    releaseCompetingPage(page([{ id: 'P2' }], 2, false))
    const firstResult = await firstPoll

    expect(firstResult.input.payloads).toEqual([{ id: 'P1' }])
    expect(secondResult.input.payloads).toEqual([{ id: 'P2' }])
    expect(state.webhooks[0].providerConfig.externalWebhookCursor).toBe(2)
    expect(state.pendingExecutions[0].payload.airtablePollStage.payloads).toEqual([{ id: 'P1' }])
    expect(state.pendingExecutions[1].payload.airtablePollStage.payloads).toEqual([{ id: 'P2' }])
  })

  it('retries an interrupted response stream without duplicating the durable receipt', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'P1' }], 1, true))
      .mockResolvedValueOnce(interruptedPage())
      .mockResolvedValueOnce(page([{ id: 'P2' }], 2, false))

    const polling = poll(structuredClone(state.webhooks[0]), 'execution-a')
    await vi.advanceTimersByTimeAsync(1_000)
    const result = await polling

    expect(result.input?.payloads).toEqual([{ id: 'P1' }, { id: 'P2' }])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(state.webhooks[0].providerConfig.externalWebhookCursor).toBe(2)
  })

  it('executes a durable prefix and admits its continuation after retry exhaustion', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'P1' }], 1, true))
      .mockImplementation(retryableFailure)
    runWorkflowMock.mockResolvedValueOnce({ result: { success: true, output: {} } })

    const execution = execute()
    await vi.advanceTimersByTimeAsync(31_000)
    await expect(execution).resolves.toMatchObject({ success: true })

    expect(runWorkflowMock.mock.calls[0][0].workflowInput.payloads).toEqual([{ id: 'P1' }])
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(enqueueExecutionMock.mock.calls[0][0].pendingExecutionId).toBe(
      'webhook_execution:webhook-1:airtable:remote:1'
    )
    expect(loggingFailureMock).not.toHaveBeenCalled()
  })

  it('does not execute staged data after losing pending-row ownership', async () => {
    fetchMock.mockResolvedValueOnce(page([{ id: 'P1' }], 1, true)).mockImplementationOnce(() => {
      state.pendingExecutions = []
      return page([{ id: 'P2' }], 2, false)
    })

    await expect(poll(structuredClone(state.webhooks[0]), 'execution-a')).rejects.toThrow(
      'lost processing ownership'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds an unstaged retryable failure with the normal terminal execution log', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(retryableFailure)

    const execution = execute()
    await vi.advanceTimersByTimeAsync(31_000)
    await expect(execution).resolves.toMatchObject({ success: false })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(loggingFailureMock).toHaveBeenCalledOnce()
  })

  it('terminally logs a revoked Airtable credential and bounds its queue lifetime', async () => {
    tokenMock.mockResolvedValueOnce(null)

    await expect(execute()).resolves.toMatchObject({ success: false })
    expect(loggingFailureMock).toHaveBeenCalledOnce()
  })

  it('retains crash recovery when terminal failure logging cannot persist', async () => {
    tokenMock.mockResolvedValueOnce(null)
    loggingFailureMock.mockRejectedValueOnce(new Error('logging unavailable'))

    await expect(execute()).rejects.toThrow('connection required')
  })

  it('executes a durable receipt when a later response permanently fails', async () => {
    fetchMock
      .mockResolvedValueOnce(page([{ id: 'P1' }], 1, true))
      .mockResolvedValueOnce(page([{ id: 'P2' }], 1, true))

    const result = await poll(structuredClone(state.webhooks[0]), 'execution-a')

    expect(result).toMatchObject({
      input: { payloads: [{ id: 'P1' }] },
      continuation: { externalId: 'remote', cursor: 1 },
    })
    expect(state.webhooks[0].providerConfig.externalWebhookCursor).toBe(1)
    expect(state.pendingExecutions[0].payload.airtablePollStage).toMatchObject({
      apiCallCount: 1,
      cursor: 1,
      payloads: [{ id: 'P1' }],
    })
  })

  it('stops an empty same-cursor response without scheduling execution or continuation', async () => {
    state.webhooks[0].providerConfig.externalWebhookCursor = 2
    fetchMock.mockResolvedValue(page([], 2, true))

    const result = await poll(structuredClone(state.webhooks[0]), 'execution-a')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result).toEqual({ input: undefined, continuation: null })
    expect(state.webhooks[0].providerConfig.externalWebhookCursor).toBe(2)
    expect(state.pendingExecutions[0].payload).not.toHaveProperty('airtablePollStage')
  })

  it('admits only after success and recovers admission without replaying', async () => {
    queueTenPages()
    enqueueExecutionMock.mockRejectedValueOnce(new Error('admission failed'))
    let finishRunner!: (value: Row) => void
    runWorkflowMock.mockReturnValue(
      new Promise((resolve) => {
        finishRunner = resolve
      })
    )

    const execution = execute()
    await vi.waitFor(() => expect(runWorkflowMock).toHaveBeenCalledOnce())
    expect(enqueueExecutionMock).not.toHaveBeenCalled()

    finishRunner({ result: { success: true, output: { processed: true } } })
    await expect(execution).rejects.toThrow('admission failed')

    const admission = enqueueExecutionMock.mock.calls[0][0]
    expect(admission.pendingExecutionId).toBe('webhook_execution:webhook-1:airtable:remote:10')
    expect(admission.payload).not.toHaveProperty('airtablePollStage')
    state.workflowExecutionLogs = [
      { executionId: 'execution-a', level: 'info', endedAt: new Date() },
    ]

    await execute(state.pendingExecutions[0].payload)

    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(runWorkflowMock).toHaveBeenCalledOnce()
    expect(enqueueExecutionMock).toHaveBeenCalledTimes(2)
  })

  it('does not admit later pages when the producing workflow fails', async () => {
    queueTenPages()
    runWorkflowMock.mockResolvedValue({ result: { success: false, output: {} } })

    await execute()

    expect(enqueueExecutionMock).not.toHaveBeenCalled()
  })

  it('logs an empty producing batch before admitting its continuation', async () => {
    queueTenPages([])

    await execute()

    expect(runWorkflowMock).not.toHaveBeenCalled()
    expect(loggingCompleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      enqueueExecutionMock.mock.invocationCallOrder[0]
    )
  })
})

describe('webhook revision ownership', () => {
  const providerRow = (provider: string, providerConfig: Row): Row => ({
    id: 'provider-webhook',
    path: 'provider-path',
    provider,
    providerConfig,
    isActive: true,
    updatedAt: new Date(0),
  })
  const teamsConfig = {
    triggerId: 'microsoftteams_chat_subscription',
    credentialId: 'credential-1',
    chatId: 'chat-1',
  }
  const teamsWorkflow = { workspaceId: 'workspace-1' }
  const persistProvider = (snapshot: Row) => (client: Row) => {
    const revision = getWebhookSnapshotRevision(snapshot as any)
    return client
      .update(tables.webhook)
      .set({ ...snapshot, updatedAt: revision.updatedAt })
      .where(revision.where)
      .returning()
  }
  const setupTeams = (webhook: Row, persist = persistProvider(webhook)) =>
    createTeamsSubscription(webhook as any, teamsWorkflow, 'teams', persist)
  const webflowScope = { userId: 'user-1', workspaceId: 'workspace-1' }
  const setupWebflow = (webhook: Row, persist = persistProvider(webhook)) =>
    createWebflowWebhookSubscription(webhook, 'webflow', webflowScope, persist)
  const removeTeams = (webhook: Row, requestId: string) =>
    deleteTeamsWebhook(webhook, teamsWorkflow, requestId)
  const removeWebflow = (webhook: Row, requestId: string) =>
    deleteWebflowWebhook(webhook, { userId: 'user-1', workspaceId: 'workspace-1' }, requestId)
  beforeEach(() => {
    state.webhooks = []
    fetchMock.mockReset()
    tokenMock.mockReset()
    tokenMock.mockResolvedValue('token')
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('rejects changed provider, active state, and timestamp snapshots', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10)
    expect(getWebhookRevision({ id: 'webhook-1', updatedAt: new Date(10) }).updatedAt).toEqual(
      new Date(11)
    )
    clock.mockRestore()
    const row = providerRow('gmail', {})
    const owns = getWebhookSnapshotRevision(row as any).where as unknown as Where
    expect(owns(row)).toBe(true)
    expect(owns({ ...row, provider: 'airtable' })).toBe(false)
    expect(owns({ ...row, isActive: false })).toBe(false)
    expect(owns({ ...row, updatedAt: new Date(1) })).toBe(false)
  })
  it('extracts credential ownership from every supported external subscription state', () => {
    expect(
      getExternalSubscriptionCredentialIds({
        provider: 'airtable',
        providerConfig: {
          credentialId: 'active',
          airtablePendingCleanup: [{ credentialId: 'pending' }],
          airtableLifecycle: {
            phase: 'cleanup',
            target: { credentialId: 'cleanup' },
            resume: { phase: 'provisioning', previous: { credentialId: 'previous' } },
          },
        },
      } as any)
    ).toEqual(['active', 'cleanup', 'pending', 'previous'])
    expect(
      getExternalSubscriptionCredentialIds({
        provider: 'microsoftteams',
        providerConfig: { triggerId: 'other', credentialId: 'poll-only' },
      } as any)
    ).toEqual([])
    expect(
      getExternalSubscriptionCredentialIds({
        provider: 'webflow',
        providerConfig: { credentialId: 'webflow' },
      } as any)
    ).toEqual(['webflow'])
  })
  it('owns and compensates Teams provisioning in one transaction', async () => {
    const snapshot = providerRow('microsoftteams', teamsConfig)
    state.webhooks = [structuredClone(snapshot)]
    await expect(setupTeams(snapshot, async () => [])).rejects.toBeInstanceOf(
      WebhookRevisionConflictError
    )
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await setupTeams(snapshot)).toBeNull()
    expect(state.webhooks).toEqual([snapshot])

    fetchMock.mockResolvedValueOnce(
      Response.json({ id: 'teams-remote', expirationDateTime: 'later' })
    )
    const saved = await setupTeams(snapshot)
    expect((saved?.providerConfig as Row).externalSubscriptionId).toBe('teams-remote')
    expect(state.webhooks).toEqual([saved])

    state.webhooks = [structuredClone(snapshot)]
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'created-remote', expirationDateTime: 'later' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(
      setupTeams(snapshot, async () => [{ ...snapshot, id: 'missing', updatedAt: new Date(1) }])
    ).rejects.toBeInstanceOf(WebhookRevisionConflictError)
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/subscriptions/created-remote')
    expect(state.webhooks).toEqual([snapshot])
  })
  it('does not treat a failed Teams existence check as absence', async () => {
    const snapshot = providerRow('microsoftteams', {
      ...teamsConfig,
      externalSubscriptionId: 'existing',
    })
    state.webhooks = [structuredClone(snapshot)]
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await setupTeams(snapshot)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('rolls back failed Teams deletion and does not clean up after a lost claim', async () => {
    const snapshot = providerRow('microsoftteams', {
      ...teamsConfig,
      externalSubscriptionId: 'existing',
    })
    state.webhooks = [structuredClone(snapshot)]
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(removeTeams(snapshot, 'teams-delete')).rejects.toThrow()
    expect(state.webhooks).toEqual([snapshot])
    state.webhooks[0] = { ...provisioning(), updatedAt: new Date(1) }
    fetchMock.mockClear()
    expect(await removeTeams(snapshot, 'stale-delete')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    state.webhooks = [structuredClone(snapshot)]
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await removeTeams(snapshot, 'retry')).toEqual(snapshot)
    expect(state.webhooks).toEqual([])
  })
  it('keeps a Webflow owner until remote deletion is terminal', async () => {
    const snapshot = providerRow('webflow', {
      credentialId: 'credential-1',
      externalId: 'webflow-remote',
    })
    state.webhooks = [structuredClone(snapshot)]
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(removeWebflow(snapshot, 'webflow-delete')).rejects.toThrow()
    expect(state.webhooks).toEqual([snapshot])

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await removeWebflow(snapshot, 'webflow-retry')).toEqual(snapshot)
    expect(state.webhooks).toEqual([])
  })
  it('owns Webflow persistence, provisioning, and rollback in one transaction', async () => {
    const snapshot = providerRow('webflow', {
      credentialId: 'credential-1',
      siteId: 'site-1',
      triggerId: 'webflow_form_submission',
      formId: 'form-1',
    })
    state.webhooks = [structuredClone(snapshot)]
    await expect(setupWebflow(snapshot, async () => [])).rejects.toBeInstanceOf(
      WebhookRevisionConflictError
    )
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(setupWebflow(snapshot)).rejects.toThrow()
    expect(state.webhooks).toEqual([snapshot])

    fetchMock.mockResolvedValueOnce(Response.json({ id: 'webflow-remote' }))
    const saved = await setupWebflow(snapshot)
    expect((saved.providerConfig as Row).externalId).toBe('webflow-remote')
    expect(state.webhooks).toEqual([saved])
  })
  it('does not call Telegram after a stale ownership claim', async () => {
    const snapshot = providerRow('telegram', { botToken: 'bot' })
    state.webhooks = [{ ...structuredClone(snapshot), updatedAt: new Date(1) }]
    await expect(createTelegramWebhook(snapshot, 'telegram')).rejects.toBeInstanceOf(
      WebhookRevisionConflictError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
const request = (body: Row) => ({ json: async () => body }) as NextRequest
const webhookRow = (): Row => ({
  id: 'webhook-1',
  workflowId: 'workflow-1',
  blockId: 'block-1',
  path: 'webhook-path',
  provider: 'generic',
  providerConfig: {},
  isActive: true,
  updatedAt: new Date(0),
})
const webhookParams = { params: Promise.resolve({ id: 'webhook-1' }) }
const postGenericWebhook = (provider: unknown, providerConfig?: Row) =>
  postWebhook(request({ workflowId: 'workflow-1', path: 'webhook-path', provider, providerConfig }))
const patchGenericWebhook = (body: Row) => patchWebhook(request(body), webhookParams)
const deleteGenericWebhook = () => deleteWebhook(request({}), webhookParams)
describe('generic webhook provider identity', () => {
  beforeEach(() => {
    state.webhooks = []
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })
  it.each([undefined, null, 42, '', '   '])(
    'rejects invalid POST provider %j',
    async (provider) => {
      const response = await postGenericWebhook(provider)
      expect(response.status).toBe(400)
      expect(state.webhooks).toEqual([])
    }
  )
  it.each([null, 42, '', '   '])('rejects invalid PATCH provider %j', async (provider) => {
    state.webhooks = [webhookRow()]
    const before = structuredClone(state.webhooks)
    const response = await patchGenericWebhook({ provider })
    expect(response.status).toBe(409)
    expect(state.webhooks).toEqual(before)
  })
  it('normalizes provider identity and preserves it when PATCH omits the field', async () => {
    const created = await postGenericWebhook(' generic ')
    expect(created.status).toBe(201)
    expect(state.webhooks[0].provider).toBe('generic')

    const updated = await patchGenericWebhook({ providerConfig: { current: true } })
    expect(updated.status).toBe(200)
    expect(state.webhooks[0]).toMatchObject({
      provider: 'generic',
      providerConfig: { current: true },
    })
  })
  it('normalizes before enforcing provider ownership', async () => {
    const post = await postGenericWebhook(' indicator ')
    expect(post.status).toBe(403)
    state.webhooks = [webhookRow()]
    const before = structuredClone(state.webhooks)
    expect((await postGenericWebhook('github')).status).toBe(409)
    const patch = await patchGenericWebhook({ provider: ' portfolio ' })
    expect(patch.status).toBe(409)
    expect(state.webhooks).toEqual(before)
  })
  it('owns Microsoft Graph callback paths instead of accepting the editor path', async () => {
    fetchMock.mockReset()
    tokenMock.mockResolvedValueOnce('token')
    fetchMock.mockResolvedValueOnce(
      Response.json({ id: 'teams-remote', expirationDateTime: 'later' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await postWebhook(
      request({
        workflowId: 'workflow-1',
        blockId: 'block-1',
        path: 'editor-path',
        provider: 'microsoftteams',
        providerConfig: {
          triggerId: 'microsoftteams_chat_subscription',
          credentialId: 'credential-1',
          chatId: 'chat-1',
        },
      })
    )

    expect(response.status).toBe(201)
    expect(isMicrosoftTeamsChatCallbackPath(state.webhooks[0].path)).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).notificationUrl).toContain(
      `/api/webhooks/trigger/${state.webhooks[0].path}`
    )
  })
  it('requires POST to repair provider-null rows but still allows deletion', async () => {
    state.webhooks = [{ ...webhookRow(), provider: null }]
    expect((await patchGenericWebhook({ providerConfig: { current: true } })).status).toBe(409)
    expect((await deleteGenericWebhook()).status).toBe(200)
    expect(state.webhooks).toEqual([])
  })
  it('lists and saves a provider-null row while excluding monitor webhooks', async () => {
    state.webhooks = [
      { ...webhookRow(), id: 'monitor-1', path: 'monitor-path', provider: 'portfolio' },
      { ...webhookRow(), provider: null },
    ]
    const url = 'https://x?workflowId=workflow-1&blockId=block-1'
    const response = await getWebhooks({ url } as NextRequest)
    const result = await response.json()
    expect(result.webhooks.map(({ webhook }: Row) => webhook.id)).toEqual(['webhook-1'])
    state.webhooks = [{ ...webhookRow(), provider: null }]
    const providerConfig = { requireAuth: true, token: 'secret' }
    expect((await postGenericWebhook('generic', providerConfig)).status).toBe(200)
    expect(state.webhooks).toMatchObject([{ provider: 'generic', providerConfig }])
  })
})
describe('webhook editor provider ownership', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
  })
  it('provisions a discovered providerless row before using config-only PATCH', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    const providerConfig = { requireAuth: true, token: 'secret' }
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          webhooks: [
            {
              webhook: {
                id: 'webhook-1',
                path: 'webhook-path',
                provider: null,
                providerConfig: null,
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          webhook: { id: 'webhook-1', path: 'webhook-path', provider: 'generic' },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    let management!: ReturnType<typeof useWebhookManagement>
    const host = document.createElement('div')
    const root = createRoot(host)
    const Harness = () => {
      management = useWebhookManagement({ blockId: 'block-1', useWebhookUrl: true })
      return null
    }
    await act(async () => root.render(createElement(Harness)))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(management.isLoading).toBe(false)
    })
    await act(async () => expect(await management.saveConfig(providerConfig)).toBe(true))
    await act(async () => expect(await management.saveConfig(providerConfig)).toBe(true))
    expect(fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init.method])).toEqual([
      ['/api/webhooks', 'POST'],
      ['/api/webhooks/webhook-1', 'PATCH'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      path: 'webhook-path',
      provider: 'generic',
      providerConfig: { ...providerConfig, triggerId: 'generic_webhook' },
    })
    act(() => root.unmount())
  })
})
const scopes = [
  { owner: { userId: 'user-1' }, put: (req: NextRequest) => putPersonal(req) },
  {
    owner: { workspaceId: 'workspace-1' },
    put: (req: NextRequest) =>
      putWorkspace(req, { params: Promise.resolve({ id: 'workspace-1' }) }),
  },
] as const
const environmentRow = (owner: Row, key: string): Row => ({
  id: `${key.toLowerCase()}-id`,
  ...owner,
  key,
  value: key,
  createdAt: new Date(1),
})
const save = async (
  put: (request: NextRequest) => Promise<Response>,
  originalKey: string | null,
  key: string,
  value = 'secret'
) => (await put(request({ originalKey, key, value }))).status
describe.each(scopes)('environment-variable writes', ({ owner, put }) => {
  beforeEach(() => {
    state.environment = []
  })
  it('renames atomically, rejects collisions, and retains scoped upserts', async () => {
    state.environment = [environmentRow(owner, 'A')]
    expect(await save(put, 'A', 'C')).toBe(200)
    expect(state.environment[0]).toMatchObject({ id: 'a-id', key: 'C', value: 'secret' })
    expect(state.environment[0].createdAt).toEqual(new Date(1))
    state.environment = []
    expect(await save(put, 'missing', 'C')).toBe(404)
    state.environment = [environmentRow(owner, 'A'), environmentRow(owner, 'B')]
    const before = structuredClone(state.environment)
    expect(await save(put, 'A', 'B')).toBe(409)
    expect(state.environment).toEqual(before)
    const other = 'userId' in owner ? { workspaceId: 'workspace-1' } : { userId: 'user-1' }
    state.environment = [environmentRow(owner, 'A'), environmentRow(other, 'B')]
    expect(await save(put, 'A', 'B', 'renamed')).toBe(200)
    const renamed = state.environment.find((row) => row.id === 'a-id')
    expect(await save(put, null, 'B', 'upserted')).toBe(200)
    expect(renamed).toMatchObject({ id: 'a-id', key: 'B', value: 'upserted' })
  })
})
const environmentProjection = (scope: 'workspace' | 'personal', key?: string) => {
  const row = key ? [{ key, value: 'secret' }] : []
  return {
    conflicts: [],
    workspaceRows: scope === 'workspace' ? row : [],
    personalRows: scope === 'personal' ? row : [],
  }
}
const findButton = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(label))

const changeInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const waitForUi = (assertion: () => unknown) => act(() => vi.waitFor(assertion))
describe('environment editor write settlement', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    environmentSaveMock.mockReset()
    environmentDeleteMock.mockReset()
    workspaceEnvironmentMock.mockReset()
    personalEnvironmentMock.mockReset()
    personalEnvironmentMock.mockResolvedValue({})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })
  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
  })
  const renderEditor = async (scope: 'workspace' | 'personal') => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(EnvironmentVariables, { workspaceId: 'workspace-1', keyScope: scope })
        )
      )
    })
    await waitForUi(() => expect(findButton(container, 'Edit environment variable')).toBeEnabled())
  }
  const renameAtoB = async () => {
    await act(async () => findButton(container, 'Edit environment variable')?.click())
    const keyInput = container.querySelector<HTMLInputElement>('input[aria-label="Variable"]')!
    act(() => changeInput(keyInput, 'B'))
    return findButton(container, 'Save environment variable') as HTMLButtonElement
  }

  it.each(['workspace', 'personal'] as const)(
    'never replays a committed %s rename when refresh fails',
    async (scope) => {
      workspaceEnvironmentMock
        .mockResolvedValueOnce(environmentProjection(scope, 'A'))
        .mockRejectedValueOnce(new Error('GET failed'))
        .mockResolvedValueOnce(environmentProjection(scope, 'B'))
      let completeSave!: () => void
      environmentSaveMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeSave = resolve
          })
      )
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await renderEditor(scope)
      const saveButton = await renameAtoB()
      await act(async () => saveButton.click())
      await waitForUi(() => expect(saveButton).toBeDisabled())
      expect(saveButton).toHaveAttribute('aria-busy', 'true')
      expect(container.querySelector('[role="status"]')).toBeTruthy()
      act(() => saveButton.click())
      expect(environmentSaveMock).toHaveBeenCalledTimes(1)
      await act(async () => completeSave())
      await waitForUi(() => expect(container.textContent).toContain('was committed'))
      expect(environmentSaveMock).toHaveBeenCalledTimes(1)
      expect(environmentSaveMock).toHaveBeenCalledWith(
        expect.objectContaining({ scope, originalKey: 'A', key: 'B' })
      )
      expect(container.querySelector('input[aria-label="Variable"]')).toBeNull()
      expect(findButton(container, 'Edit environment variable')).toBeDisabled()
      expect(invalidate).toHaveBeenCalledWith(
        {
          queryKey:
            scope === 'personal' ? ['environment'] : ['environment', 'workspace', 'workspace-1'],
        },
        { throwOnError: true }
      )
      await act(async () => findButton(container, 'Refresh variables')?.click())
      await waitForUi(() =>
        expect(findButton(container, 'Edit environment variable')).toBeEnabled()
      )
      expect(container.textContent).toContain('B')
      expect(environmentSaveMock).toHaveBeenCalledTimes(1)
    }
  )

  it('retains a pre-commit rename draft for a legitimate write retry', async () => {
    workspaceEnvironmentMock
      .mockResolvedValueOnce(environmentProjection('workspace', 'A'))
      .mockResolvedValueOnce(environmentProjection('workspace', 'B'))
    environmentSaveMock
      .mockRejectedValueOnce(new Error('PUT failed'))
      .mockResolvedValueOnce(undefined)
    await renderEditor('workspace')
    await act(async () => (await renameAtoB()).click())
    await waitForUi(() => expect(container.textContent).toContain('could not be confirmed'))
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Variable"]')?.value).toBe(
      'B'
    )
    await act(async () => findButton(container, 'Save environment variable')?.click())
    await waitForUi(() =>
      expect(container.querySelector('input[aria-label="Variable"]')).toBeNull()
    )
    expect(environmentSaveMock).toHaveBeenCalledTimes(2)
    expect(environmentSaveMock.mock.calls.map(([write]) => write.originalKey)).toEqual(['A', 'A'])
  })
})
