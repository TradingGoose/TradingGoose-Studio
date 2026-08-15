/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { useUserInputMentionSources } from './use-user-input-mention-sources'

const m = vi.hoisted(() => ({
  blockCatalogGate: Promise.resolve() as Promise<void>,
  blockCatalogLoadStarted: vi.fn(),
  blockCatalogObservations: [] as Array<{
    locale: string
    names: string[]
    isLoading: boolean
  }>,
  bootstrapYjsProvider: vi.fn(),
  entityList: { members: [], isLoading: false },
  getEntityListMembers: (doc: any) => doc.members,
  locale: 'en',
  logger: { error: vi.fn() },
  registryGate: Promise.resolve() as Promise<void>,
  registryLoadStarted: vi.fn(),
  workspaceListObservations: [] as Array<{
    workspaceId: string
    ownerUserId: string | null
    chatIds: string[]
    logIds: string[]
    watchlistIds: string[]
    chatsLoading: boolean
    logsLoading: boolean
    watchlistLoading: boolean
  }>,
  workflowBlocks: {},
  workflowBlockObservations: [] as Array<{
    workflowId: string | null
    blockIds: string[]
    isLoading: boolean
  }>,
  workflowId: null as string | null,
  workflowInspectorMessages: {
    en: { locale: 'en' },
    es: { locale: 'es' },
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
const EMPTY_WORKFLOW_BLOCKS = {}

let current: ReturnType<typeof useUserInputMentionSources>

beforeEach(() => {
  vi.resetModules()
  m.blockCatalogGate = Promise.resolve()
  m.blockCatalogLoadStarted.mockReset()
  m.blockCatalogObservations.length = 0
  m.bootstrapYjsProvider.mockReset()
  m.entityList = { members: [], isLoading: false }
  m.locale = 'en'
  m.logger.error.mockReset()
  m.registryGate = Promise.resolve()
  m.registryLoadStarted.mockReset()
  m.workspaceListObservations.length = 0
  m.workflowBlocks = EMPTY_WORKFLOW_BLOCKS
  m.workflowBlockObservations.length = 0
  m.workflowId = null
  vi.unstubAllGlobals()
})

const Harness = ({
  ownerUserId = null,
  workspaceId,
}: {
  ownerUserId?: string | null
  workspaceId: string
}) => {
  current = useUserInputMentionSources({ ownerUserId, workspaceId })
  m.workspaceListObservations.push({
    workspaceId,
    ownerUserId,
    chatIds: current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId),
    logIds: current.mentionSources.logsList.map(({ id }) => id),
    watchlistIds: current.mentionSources.workspaceEntities.watchlist.map(({ id }) => id),
    chatsLoading: current.mentionLoading.chats,
    logsLoading: current.mentionLoading.logs,
    watchlistLoading: current.mentionLoading.watchlist,
  })
  m.blockCatalogObservations.push({
    locale: m.locale,
    names: current.mentionSources.blocksList.map(({ name }) => name),
    isLoading: current.mentionLoading.blocks,
  })
  m.workflowBlockObservations.push({
    workflowId: m.workflowId,
    blockIds: current.mentionSources.workflowBlocks.map(({ id }) => id),
    isLoading: current.mentionLoading.workflow_blocks,
  })
  return null
}

it('keeps workspace generations isolated while retrying empty snapshots on later demand', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  const [oldA, oldB, emptyA, retryA] = [deferred(), deferred(), deferred(), deferred()]
  m.bootstrapYjsProvider
    .mockReturnValueOnce(oldA.promise)
    .mockReturnValueOnce(oldB.promise)
    .mockReturnValueOnce(emptyA.promise)
    .mockReturnValueOnce(retryA.promise)

  for (const workspaceId of ['workspace-a', 'workspace-b', 'workspace-a']) {
    await act(async () => root.render(<Harness workspaceId={workspaceId} />))
    act(() => void current.ensureSubmenuLoaded('watchlist'))
  }

  const staleResult = providerResult([
    { entityId: 'old-a', entityName: 'Old A', updatedAt: '2026-04-01T00:00:00.000Z' },
  ])
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

  act(() => void current.ensureSubmenuLoaded('watchlist'))
  const activeResult = providerResult([
    { entityId: 'watchlist-old', entityName: 'Old', updatedAt: '2026-04-01T00:00:00.000Z' },
    { entityId: 'watchlist-new', entityName: 'New', updatedAt: '2026-04-02T00:00:00.000Z' },
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
  act(() => root.unmount())
  document.body.replaceChildren()
})

it('keeps deferred past-chat and log results scoped to their originating workspace', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
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
  m.workspaceListObservations.length = 0
  vi.stubGlobal('fetch', fetchMock)

  try {
    await act(async () => root.render(<Harness workspaceId='workspace-a' />))
    let chatALoad!: Promise<void>
    let logsALoad!: Promise<void>
    act(() => {
      chatALoad = current.ensureSubmenuLoaded('chats')
      logsALoad = current.ensureSubmenuLoaded('logs')
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    m.workspaceListObservations.length = 0
    await act(async () => root.render(<Harness workspaceId='workspace-b' />))
    const workspaceBTransition = m.workspaceListObservations.filter(
      ({ workspaceId }) => workspaceId === 'workspace-b'
    )
    expect(workspaceBTransition.length).toBeGreaterThan(0)
    expect(
      workspaceBTransition.every(
        ({ chatIds, logIds, chatsLoading, logsLoading }) =>
          chatIds.length === 0 && logIds.length === 0 && !chatsLoading && !logsLoading
      )
    ).toBe(true)

    let chatBLoad!: Promise<void>
    let logsBLoad!: Promise<void>
    act(() => {
      chatBLoad = current.ensureSubmenuLoaded('chats')
      logsBLoad = current.ensureSubmenuLoaded('logs')
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    await act(async () => {
      chatB.resolve(response({ chats: [{ reviewSessionId: 'chat-b', title: 'Chat B' }] }))
      logsB.resolve(
        response({
          data: [
            {
              id: 'log-b',
              level: 'info',
              trigger: null,
              startedAt: '2026-08-13T00:00:00.000Z',
              workflow: { name: 'Workflow B' },
            },
          ],
        })
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
        response({
          data: [
            {
              id: 'log-a',
              level: 'error',
              trigger: null,
              startedAt: '2026-08-12T00:00:00.000Z',
              workflow: { name: 'Workflow A' },
            },
          ],
        })
      )
      await Promise.all([chatALoad, logsALoad])
    })
    expect(current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId)).toEqual([
      'chat-b',
    ])
    expect(current.mentionSources.logsList.map(({ id }) => id)).toEqual(['log-b'])
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it('isolates deferred and loaded mention sources across authenticated owners', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const chatA = deferred()
  const logsA = deferred()
  const watchlistA = deferred()
  const chatB = deferred()
  const logsB = deferred()
  const watchlistB = deferred()
  let chatRequestCount = 0
  let logRequestCount = 0
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/copilot/chat')) {
      return chatRequestCount++ === 0 ? chatA.promise : chatB.promise
    }
    if (url.startsWith('/api/logs')) {
      return logRequestCount++ === 0 ? logsA.promise : logsB.promise
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const response = (body: unknown) => ({ ok: true, json: async () => body })
  m.bootstrapYjsProvider
    .mockReset()
    .mockReturnValueOnce(watchlistA.promise)
    .mockReturnValueOnce(watchlistB.promise)
  m.workspaceListObservations.length = 0
  vi.stubGlobal('fetch', fetchMock)

  try {
    await act(async () =>
      root.render(<Harness ownerUserId='user-a' workspaceId='shared-workspace' />)
    )
    let chatALoad!: Promise<void>
    let logsALoad!: Promise<void>
    let watchlistALoad!: Promise<void>
    act(() => {
      chatALoad = current.ensureSubmenuLoaded('chats')
      logsALoad = current.ensureSubmenuLoaded('logs')
      watchlistALoad = current.ensureSubmenuLoaded('watchlist')
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(m.bootstrapYjsProvider).toHaveBeenCalledOnce()
    })

    m.workspaceListObservations.length = 0
    await act(async () =>
      root.render(<Harness ownerUserId='user-b' workspaceId='shared-workspace' />)
    )
    const ownerBTransition = m.workspaceListObservations.filter(
      ({ ownerUserId }) => ownerUserId === 'user-b'
    )
    expect(ownerBTransition.length).toBeGreaterThan(0)
    expect(
      ownerBTransition.every(
        ({ chatIds, logIds, watchlistIds, chatsLoading, logsLoading, watchlistLoading }) =>
          chatIds.length === 0 &&
          logIds.length === 0 &&
          watchlistIds.length === 0 &&
          !chatsLoading &&
          !logsLoading &&
          !watchlistLoading
      )
    ).toBe(true)

    let chatBLoad!: Promise<void>
    let logsBLoad!: Promise<void>
    let watchlistBLoad!: Promise<void>
    act(() => {
      chatBLoad = current.ensureSubmenuLoaded('chats')
      logsBLoad = current.ensureSubmenuLoaded('logs')
      watchlistBLoad = current.ensureSubmenuLoaded('watchlist')
    })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(m.bootstrapYjsProvider).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      chatB.resolve(response({ chats: [{ reviewSessionId: 'chat-b', title: 'Chat B' }] }))
      logsB.resolve(
        response({
          data: [
            {
              id: 'log-b',
              level: 'info',
              trigger: null,
              startedAt: '2026-08-13T00:00:00.000Z',
              workflow: { name: 'Workflow B' },
            },
          ],
        })
      )
      watchlistB.resolve(
        providerResult([
          {
            entityId: 'watchlist-b',
            entityName: 'Watchlist B',
            updatedAt: '2026-08-13T00:00:00.000Z',
          },
        ])
      )
      await Promise.all([chatBLoad, logsBLoad, watchlistBLoad])
    })
    expect(current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId)).toEqual([
      'chat-b',
    ])
    expect(current.mentionSources.logsList.map(({ id }) => id)).toEqual(['log-b'])
    expect(current.mentionSources.workspaceEntities.watchlist.map(({ id }) => id)).toEqual([
      'watchlist-b',
    ])

    await act(async () => {
      chatA.resolve(response({ chats: [{ reviewSessionId: 'chat-a', title: 'Chat A' }] }))
      logsA.resolve(
        response({
          data: [
            {
              id: 'log-a',
              level: 'error',
              trigger: null,
              startedAt: '2026-08-12T00:00:00.000Z',
              workflow: { name: 'Workflow A' },
            },
          ],
        })
      )
      watchlistA.resolve(
        providerResult([
          {
            entityId: 'watchlist-a',
            entityName: 'Watchlist A',
            updatedAt: '2026-08-12T00:00:00.000Z',
          },
        ])
      )
      await Promise.all([chatALoad, logsALoad, watchlistALoad])
    })
    expect(current.mentionSources.pastChats.map(({ reviewSessionId }) => reviewSessionId)).toEqual([
      'chat-b',
    ])
    expect(current.mentionSources.logsList.map(({ id }) => id)).toEqual(['log-b'])
    expect(current.mentionSources.workspaceEntities.watchlist.map(({ id }) => id)).toEqual([
      'watchlist-b',
    ])

    const logRequests = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('/api/logs'))
    expect(logRequests).toHaveLength(2)
    expect(
      logRequests.every((url) => !new URL(url, 'http://localhost').searchParams.has('details'))
    ).toBe(true)

    await act(async () =>
      root.render(<Harness ownerUserId='user-c' workspaceId='shared-workspace' />)
    )
    await act(async () =>
      root.render(<Harness ownerUserId='user-b' workspaceId='shared-workspace' />)
    )
    expect(current.mentionSources.pastChats).toEqual([])
    expect(current.mentionSources.logsList).toEqual([])
    expect(current.mentionSources.workspaceEntities.watchlist).toEqual([])
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it('suppresses automatic current-workflow retries but retries on explicit submenu demand', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
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

  try {
    m.workflowId = 'workflow-1'
    await act(async () => root.render(<Harness workspaceId='workspace-1' />))
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
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it('discards a deferred block catalog load when the locale changes', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const catalogGate = deferred()
  m.blockCatalogGate = catalogGate.promise
  m.blockCatalogLoadStarted.mockClear()
  m.blockCatalogObservations.length = 0

  try {
    m.locale = 'en'
    await act(async () => root.render(<Harness workspaceId='workspace-1' />))
    let englishLoad!: Promise<void>
    act(() => {
      englishLoad = current.ensureSubmenuLoaded('blocks')
    })
    await vi.waitFor(() => expect(m.blockCatalogLoadStarted).toHaveBeenCalledOnce())
    expect(current.mentionLoading.blocks).toBe(true)

    m.blockCatalogObservations.length = 0
    m.locale = 'zh'
    await act(async () => root.render(<Harness workspaceId='workspace-1' />))
    const zhTransition = m.blockCatalogObservations.filter(({ locale }) => locale === 'zh')
    expect(zhTransition.length).toBeGreaterThan(0)
    expect(zhTransition.every(({ names, isLoading }) => names.length === 0 && !isLoading)).toBe(
      true
    )

    let chineseLoad!: Promise<void>
    act(() => {
      chineseLoad = current.ensureSubmenuLoaded('blocks')
    })
    await act(async () => {
      catalogGate.resolve(undefined)
      await Promise.all([englishLoad, chineseLoad])
    })

    expect(current.mentionSources.blocksList.map(({ name }) => name)).toEqual(['zh:Agent'])
    expect(current.mentionLoading.blocks).toBe(false)
  } finally {
    act(() => root.unmount())
    container.remove()
    m.blockCatalogGate = Promise.resolve()
    m.locale = 'en'
  }
})

it('discards a deferred workflow block load after switching to an empty workflow', async () => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  const registryGate = deferred()
  m.registryGate = registryGate.promise
  m.registryLoadStarted.mockClear()
  m.workflowBlockObservations.length = 0

  const workflowABlocks = {
    'block-a': {
      id: 'block-a',
      type: 'agent',
      name: 'Workflow A Block',
    },
  }

  try {
    m.workflowId = 'workflow-a'
    m.workflowBlocks = workflowABlocks
    await act(async () => root.render(<Harness workspaceId='workspace-1' />))
    await vi.waitFor(() => expect(m.registryLoadStarted).toHaveBeenCalledOnce())
    expect(current.mentionLoading.workflow_blocks).toBe(true)

    m.workflowBlockObservations.length = 0
    m.workflowId = 'workflow-b'
    m.workflowBlocks = EMPTY_WORKFLOW_BLOCKS
    await act(async () => root.render(<Harness workspaceId='workspace-1' />))

    const workflowBObservations = m.workflowBlockObservations.filter(
      ({ workflowId }) => workflowId === 'workflow-b'
    )
    expect(workflowBObservations.length).toBeGreaterThan(0)
    expect(
      workflowBObservations.every(({ blockIds, isLoading }) => blockIds.length === 0 && !isLoading)
    ).toBe(true)
    expect(current.mentionSources.workflowBlocks).toEqual([])
    expect(current.mentionLoading.workflow_blocks).toBe(false)

    await act(async () => {
      registryGate.resolve(undefined)
      await registryGate.promise
      await Promise.resolve()
    })

    expect(current.mentionSources.workflowBlocks).toEqual([])
    expect(current.mentionLoading.workflow_blocks).toBe(false)
    expect(m.logger.error).not.toHaveBeenCalled()
  } finally {
    act(() => root.unmount())
    container.remove()
    m.workflowId = null
    m.workflowBlocks = EMPTY_WORKFLOW_BLOCKS
  }
})
