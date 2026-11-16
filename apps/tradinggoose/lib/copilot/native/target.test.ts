import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scope, Target } from './contract'
import { nativeConversationIdentity } from './identity'
import type { ServerPending as Pending } from './target'

const state = vi.hoisted(() => ({ list: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/copilot/agent/service', () => ({ listCopilotPending: state.list }))
vi.mock('@/lib/permissions/utils', () => ({ checkWorkspaceAccess: state.access }))

import { authorizeNativeConversationScope, resolveNativePendingTarget } from './target'

const scope: Scope = { actorUserId: 'actor', workspaceId: null }
const target: Target = {
  resourceId: nativeConversationIdentity(scope).resourceId,
  threadId: 'thread',
  runId: 'run',
  toolCallId: 'call',
  toolName: 'read_workflow',
}
const pending = (): Pending => ({
  target,
  stage: 'result',
  originalArgs: { entityId: 'workflow' },
})
beforeEach(() => {
  vi.clearAllMocks()
  state.list.mockResolvedValue([pending()])
  state.access.mockResolvedValue({ hasAccess: true })
})
describe('local native pending authorization', () => {
  it('discovers the original pending tool from local snapshots', async () => {
    const result = await resolveNativePendingTarget(scope, target, 'result')
    expect(state.list).toHaveBeenCalledWith(scope, 'thread', undefined)
    expect(result).toEqual(pending())
  })
  it('rejects foreign resources before discovery', async () => {
    await expect(
      resolveNativePendingTarget(scope, { ...target, resourceId: 'foreign' }, 'result')
    ).rejects.toMatchObject({ status: 403 })
    expect(state.list).not.toHaveBeenCalled()
  })
  it('rejects missing or stale-stage targets', async () => {
    state.list.mockResolvedValue([])
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 409,
    })
    state.list.mockResolvedValue([{ ...pending(), stage: 'approval' }])
    await expect(resolveNativePendingTarget(scope, target, 'result')).rejects.toMatchObject({
      status: 409,
    })
  })
  it('rechecks current workspace membership', async () => {
    state.access.mockResolvedValue({ hasAccess: false })
    await expect(authorizeNativeConversationScope('actor', 'revoked')).rejects.toMatchObject({
      status: 403,
    })
  })
})
