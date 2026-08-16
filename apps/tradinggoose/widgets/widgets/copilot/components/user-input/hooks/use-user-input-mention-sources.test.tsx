/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useUserInputMentionSources } from './use-user-input-mention-sources'

const m = vi.hoisted(() => ({
  bootstrapYjsProvider: vi.fn(),
  entityList: { members: [], isLoading: false },
  getEntityListMembers: (doc: any) => doc.members,
  logger: { error: vi.fn() },
  workflowBlocks: {},
}))

vi.mock('next-intl', () => ({ useLocale: () => 'en' }))
vi.mock('@/lib/yjs/provider', () => ({ bootstrapYjsProvider: m.bootstrapYjsProvider }))
vi.mock('@/lib/yjs/entity-session', () => ({ getEntityListMembers: m.getEntityListMembers }))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => m.logger }))
vi.mock('@/lib/yjs/use-entity-fields', () => ({ useEntityList: () => m.entityList }))
vi.mock('@/lib/yjs/use-workflow-doc', () => ({ useWorkflowBlocks: () => m.workflowBlocks }))
vi.mock('@/lib/yjs/workflow-session-host', () => ({ useOptionalWorkflowSession: () => null }))
vi.mock('@/i18n/workspace-widget-hooks', () => ({ useWorkflowInspectorMessages: () => ({}) }))

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

let current: ReturnType<typeof useUserInputMentionSources>
const Harness = ({ workspaceId }: { workspaceId: string }) => {
  current = useUserInputMentionSources({ workspaceId })
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
