/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MentionSubmenu } from '../types'
import { useUserInputMentionSources } from './use-user-input-mention-sources'

type MentionState = ReturnType<typeof useUserInputMentionSources>

const m = vi.hoisted(() => ({
  blockCatalogGate: Promise.resolve() as Promise<void>,
  blockCatalogLoadStarted: vi.fn(),
  bootstrapYjsProvider: vi.fn(),
  entityList: { members: [], isLoading: false },
  getEntityListMembers: (doc: any) => doc.members,
  locale: 'en',
  logger: { error: vi.fn() },
  observations: [] as Array<{
    workspaceId: string
    ownerUserId: string | null
    locale: string
    workflowId: string | null
    mentionSources: MentionState['mentionSources']
    mentionLoading: MentionState['mentionLoading']
  }>,
  registryGate: Promise.resolve() as Promise<void>,
  registryLoadStarted: vi.fn(),
  workflowBlocks: {},
  workflowId: null as string | null,
  workflowInspectorMessages: {
    en: { locale: 'en' },
    zh: { locale: 'zh' },
  } as Record<string, { locale: string }>,
}))

vi.mock('next-intl', () => ({ useLocale: () => m.locale }))
vi.mock('@/blocks', async () => {
  m.blockCatalogLoadStarted()
  await m.blockCatalogGate
  return {
    getAllBlocks: () => [
      {
        type: 'agent',
        name: 'Agent',
        category: 'blocks',
        hideFromToolbar: false,
        bgColor: '#6B7280',
      },
    ],
  }
})
vi.mock('@/blocks/registry', async () => {
  m.registryLoadStarted()
  await m.registryGate
  return { registry: { agent: { name: 'Agent', bgColor: '#6B7280' } } }
})
vi.mock('@/lib/yjs/provider', () => ({ bootstrapYjsProvider: m.bootstrapYjsProvider }))
vi.mock('@/lib/yjs/entity-session', () => ({ getEntityListMembers: m.getEntityListMembers }))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => m.logger }))
vi.mock('@/lib/yjs/use-entity-fields', () => ({ useEntityList: () => m.entityList }))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({ useWorkflowBlocks: () => m.workflowBlocks }))
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => (m.workflowId ? { workflowId: m.workflowId } : null),
}))
vi.mock('@/i18n/workflow-inspector-core', () => ({
  getLocalizedBlockNameWithCopy: (
    copy: { locale?: string },
    block: { name?: string; type: string }
  ) => `${copy.locale ?? 'en'}:${block.name ?? block.type}`,
  getLocalizedDefaultBlockNameWithCopy: (_copy: unknown, blockType: string, blockName?: string) =>
    blockName ?? blockType,
}))
vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useWorkflowInspectorMessages: () =>
    m.workflowInspectorMessages[m.locale] ?? m.workflowInspectorMessages.en,
}))

const deferred = () => {
  let resolve!: (value: any) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<any>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

const providerResult = (members: any[]) => ({ doc: { members }, dispose: vi.fn() })
const entityMember = (entityId: string, entityName: string, updatedAt: string) => ({
  entityId,
  entityName,
  updatedAt,
})
const EMPTY_WORKFLOW_BLOCKS = {}

let current: MentionState
let root: Root
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.createElement('div'))
  vi.resetModules()
  vi.resetAllMocks()
  m.blockCatalogGate = Promise.resolve()
  m.entityList = { members: [], isLoading: false }
  m.locale = 'en'
  m.observations.length = 0
  m.registryGate = Promise.resolve()
  m.workflowBlocks = EMPTY_WORKFLOW_BLOCKS
  m.workflowId = null
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

const Harness = ({
  ownerUserId = null,
  workspaceId,
}: {
  ownerUserId?: string | null
  workspaceId: string
}) => {
  current = useUserInputMentionSources({ ownerUserId, workspaceId })
  m.observations.push({
    workspaceId,
    ownerUserId,
    locale: m.locale,
    workflowId: m.workflowId,
    mentionSources: current.mentionSources,
    mentionLoading: current.mentionLoading,
  })
  return null
}

const renderHarness = (workspaceId: string, ownerUserId?: string) =>
  act(async () => root.render(<Harness workspaceId={workspaceId} ownerUserId={ownerUserId} />))

const startLoads = (...submenus: MentionSubmenu[]) => {
  let loads: Promise<void>[] = []
  act(() => {
    loads = submenus.map((submenu) => current.ensureSubmenuLoaded(submenu))
  })
  return loads
}

it('keeps workspace generations isolated while retrying empty snapshots on later demand', async () => {
  const [oldA, oldB, emptyA, retryA] = [deferred(), deferred(), deferred(), deferred()]
  m.bootstrapYjsProvider
    .mockReturnValueOnce(oldA.promise)
    .mockReturnValueOnce(oldB.promise)
    .mockReturnValueOnce(emptyA.promise)
    .mockReturnValueOnce(retryA.promise)

  for (const workspaceId of ['workspace-a', 'workspace-b', 'workspace-a']) {
    await renderHarness(workspaceId)
    startLoads('watchlist')
  }

  const staleResult = providerResult([entityMember('old-a', 'Old A', '2026-04-01T00:00:00.000Z')])
  await act(async () => oldA.resolve(staleResult))
  await act(async () => oldB.reject(new Error('obsolete workspace')))

  expect(current.mentionSources.workspaceEntities.watchlist).toEqual([])
  expect(current.mentionLoading.watchlist).toBe(true)
  expect(m.logger.error).not.toHaveBeenCalled()

  const emptyResult = providerResult([])
  const stableEnsureSubmenuLoaded = current.ensureSubmenuLoaded
  await act(async () => emptyA.resolve(emptyResult))

  expect(current.mentionSources.workspaceEntities.watchlist).toEqual([])
  expect(current.mentionLoading.watchlist).toBe(false)
  expect(current.ensureSubmenuLoaded).toBe(stableEnsureSubmenuLoaded)
  expect(m.bootstrapYjsProvider).toHaveBeenCalledTimes(3)

  startLoads('watchlist')
  const activeResult = providerResult([
    entityMember('watchlist-old', 'Old', '2026-04-01T00:00:00.000Z'),
    entityMember('watchlist-new', 'New', '2026-04-02T00:00:00.000Z'),
  ])
  await act(async () => retryA.resolve(activeResult))

  expect(current.mentionSources.workspaceEntities.watchlist).toEqual([
    { entityKind: 'watchlist', id: 'watchlist-new', name: 'New' },
    { entityKind: 'watchlist', id: 'watchlist-old', name: 'Old' },
  ])
  expect(current.mentionLoading.watchlist).toBe(false)
  expect(m.bootstrapYjsProvider.mock.calls.map(([descriptor]) => descriptor.workspaceId)).toEqual([
    'workspace-a',
    'workspace-b',
    'workspace-a',
    'workspace-a',
  ])
  expect(m.bootstrapYjsProvider).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ entityKind: 'watchlist', ownerUserId: null }),
    undefined,
    'read'
  )
  expect(staleResult.dispose).toHaveBeenCalledOnce()
  expect(emptyResult.dispose).toHaveBeenCalledOnce()
  expect(activeResult.dispose).toHaveBeenCalledOnce()
  await act(async () => current.ensureSubmenuLoaded('watchlist'))
  expect(m.bootstrapYjsProvider).toHaveBeenCalledTimes(4)
})

it('keeps deferred past-chat and log results scoped to their originating workspace', async () => {
  const chatA = deferred()
  const logsA = deferred()
  const chatB = deferred()
  const logsB = deferred()
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const workspace = new URL(url, 'http://localhost').searchParams.get('workspaceId')
    if (url.startsWith('/api/copilot/chat')) {
      return workspace === 'workspace-a' ? chatA.promise : chatB.promise
    }
    return workspace === 'workspace-a' ? logsA.promise : logsB.promise
  })
  const response = (body: unknown) => ({ ok: true, json: async () => body })
  const log = (id: string, level: string, startedAt: string, workflowName: string) => ({
    id,
    level,
    trigger: null,
    startedAt,
    workflow: { name: workflowName },
  })
  vi.stubGlobal('fetch', fetchMock)

  await renderHarness('workspace-a')
  const [chatALoad, logsALoad] = startLoads('chats', 'logs')
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

  m.observations.length = 0
  await renderHarness('workspace-b')
  const workspaceBTransition = m.observations.filter(
    ({ workspaceId }) => workspaceId === 'workspace-b'
  )
  expect(workspaceBTransition.length).toBeGreaterThan(0)
  expect(
    workspaceBTransition.every(
      ({ mentionSources, mentionLoading }) =>
        mentionSources.pastChats.length === 0 &&
        mentionSources.logsList.length === 0 &&
        !mentionLoading.chats &&
        !mentionLoading.logs
    )
  ).toBe(true)

  const [chatBLoad, logsBLoad] = startLoads('chats', 'logs')
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  await act(async () => {
    chatB.resolve(response({ chats: [{ reviewSessionId: 'chat-b', title: 'Chat B' }] }))
    logsB.resolve(
      response({ data: [log('log-b', 'info', '2026-08-13T00:00:00.000Z', 'Workflow B')] })
    )
    await Promise.all([chatBLoad, logsBLoad])
  })
  expect(current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId)).toEqual([
    'chat-b',
  ])
  expect(current.mentionSources.logsList.map(({ id }) => id)).toEqual(['log-b'])

  await act(async () => {
    chatA.resolve(response({ chats: [{ reviewSessionId: 'chat-a', title: 'Chat A' }] }))
    logsA.resolve(
      response({ data: [log('log-a', 'error', '2026-08-12T00:00:00.000Z', 'Workflow A')] })
    )
    await Promise.all([chatALoad, logsALoad])
  })
  expect(current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId)).toEqual([
    'chat-b',
  ])
  expect(current.mentionSources.logsList.map(({ id }) => id)).toEqual(['log-b'])
  expect(
    fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('/api/logs'))
      .every((url) => !new URL(url, 'http://localhost').searchParams.has('details'))
  ).toBe(true)
})

it('discards deferred entity mentions after the authenticated owner changes', async () => {
  const watchlistA = deferred()
  m.bootstrapYjsProvider.mockReturnValueOnce(watchlistA.promise)

  await renderHarness('shared-workspace', 'user-a')
  const [watchlistALoad] = startLoads('watchlist')
  await vi.waitFor(() => expect(m.bootstrapYjsProvider).toHaveBeenCalledOnce())

  m.observations.length = 0
  await renderHarness('shared-workspace', 'user-b')
  const ownerBTransition = m.observations.filter(({ ownerUserId }) => ownerUserId === 'user-b')
  expect(ownerBTransition.length).toBeGreaterThan(0)
  expect(
    ownerBTransition.every(
      ({ mentionSources, mentionLoading }) =>
        mentionSources.workspaceEntities.watchlist.length === 0 && !mentionLoading.watchlist
    )
  ).toBe(true)

  await act(async () => {
    watchlistA.resolve(
      providerResult([entityMember('watchlist-a', 'Watchlist A', '2026-08-12T00:00:00.000Z')])
    )
    await watchlistALoad
  })
  expect(current.mentionSources.workspaceEntities.watchlist).toEqual([])
})

it('suppresses automatic current-workflow retries but retries on explicit submenu demand', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 500 })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'workflow-1', name: 'Workflow 1' }],
      }),
    })
  vi.stubGlobal('fetch', fetchMock)

  m.workflowId = 'workflow-1'
  await renderHarness('workspace-1')
  await vi.waitFor(() => expect(m.logger.error).toHaveBeenCalledOnce())

  expect(fetchMock).toHaveBeenCalledOnce()
  expect(current.mentionFailed.workflow).toBe(true)
  expect(current.mentionLoading.workflow).toBe(false)
  expect(current.mentionSources.workspaceEntities.workflow).toEqual([])

  await act(async () => current.ensureSubmenuLoaded('workflow'))

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(current.mentionFailed.workflow).toBe(false)
  expect(current.mentionSources.workspaceEntities.workflow).toEqual([
    { entityKind: 'workflow', id: 'workflow-1', name: 'Workflow 1', color: undefined },
  ])
})

it('discards a deferred block catalog load when the locale changes', async () => {
  const catalogGate = deferred()
  m.blockCatalogGate = catalogGate.promise

  await renderHarness('workspace-1')
  const [englishLoad] = startLoads('blocks')
  await vi.waitFor(() => expect(m.blockCatalogLoadStarted).toHaveBeenCalledOnce())
  expect(current.mentionLoading.blocks).toBe(true)

  m.observations.length = 0
  m.locale = 'zh'
  await renderHarness('workspace-1')
  const zhTransition = m.observations.filter(({ locale }) => locale === 'zh')
  expect(zhTransition.length).toBeGreaterThan(0)
  expect(
    zhTransition.every(
      ({ mentionSources, mentionLoading }) =>
        mentionSources.blocksList.length === 0 && !mentionLoading.blocks
    )
  ).toBe(true)

  const [chineseLoad] = startLoads('blocks')
  await act(async () => {
    catalogGate.resolve(undefined)
    await Promise.all([englishLoad, chineseLoad])
  })

  expect(current.mentionSources.blocksList.map(({ name }) => name)).toEqual(['zh:Agent'])
  expect(current.mentionLoading.blocks).toBe(false)
})

it('discards a deferred workflow block load after switching to an empty workflow', async () => {
  const registryGate = deferred()
  m.registryGate = registryGate.promise

  const workflowABlocks = {
    'block-a': {
      id: 'block-a',
      type: 'agent',
      name: 'Workflow A Block',
    },
  }

  m.workflowId = 'workflow-a'
  m.workflowBlocks = workflowABlocks
  await renderHarness('workspace-1')
  await vi.waitFor(() => expect(m.registryLoadStarted).toHaveBeenCalledOnce())
  expect(current.mentionLoading.workflow_blocks).toBe(true)

  m.observations.length = 0
  m.workflowId = 'workflow-b'
  m.workflowBlocks = EMPTY_WORKFLOW_BLOCKS
  await renderHarness('workspace-1')

  const workflowBObservations = m.observations.filter(
    ({ workflowId }) => workflowId === 'workflow-b'
  )
  expect(workflowBObservations.length).toBeGreaterThan(0)
  expect(
    workflowBObservations.every(
      ({ mentionSources, mentionLoading }) =>
        mentionSources.workflowBlocks.length === 0 && !mentionLoading.workflow_blocks
    )
  ).toBe(true)

  await act(async () => {
    registryGate.resolve(undefined)
    await registryGate.promise
    await Promise.resolve()
  })

  expect(current.mentionSources.workflowBlocks).toEqual([])
  expect(current.mentionLoading.workflow_blocks).toBe(false)
  expect(m.logger.error).not.toHaveBeenCalled()
})
