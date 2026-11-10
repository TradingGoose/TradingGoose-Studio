/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  scope: vi.fn(),
  execute: vi.fn(),
  contexts: vi.fn(),
  workflow: vi.fn(),
  entity: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/copilot/agent/service', () => ({ executeCopilotCommand: mocks.execute }))
vi.mock('@/lib/copilot/native/target', () => ({
  NativeTargetError: class NativeTargetError extends Error {
    constructor(
      message: string,
      public status = 409
    ) {
      super(message)
    }
  },
  authorizeNativeConversationScope: mocks.scope,
}))
vi.mock('@/lib/copilot/process-contents', () => ({ processContextsServer: mocks.contexts }))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: mocks.entity,
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.workflow }))
vi.mock('@/lib/copilot/runtime-models', () => ({ COPILOT_RUNTIME_MODELS: ['test/model'] }))
const listing = {
  requestId: 'request',
  workspaceId: null,
  command: 'threads.list',
  page: { page: 0, perPage: 100 },
}
async function post(body: unknown) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.test/api/copilot/native', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'actual-actor' } })
  mocks.scope.mockImplementation((actorUserId, workspaceId) =>
    Promise.resolve({ actorUserId, workspaceId })
  )
  mocks.execute.mockResolvedValue(Response.json({ ok: true }))
  mocks.contexts.mockResolvedValue([])
  mocks.workflow.mockResolvedValue({ ok: true, workspaceId: 'workspace' })
  mocks.entity.mockImplementation(async (context) => ({
    workspaceId: context.workspaceId ?? 'resolved-workspace',
  }))
})
describe('built-in Copilot authenticated boundary', () => {
  it('calls the local service with authenticated actor and explicit conversation scope', async () => {
    expect((await post(listing)).status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        requestId: 'request',
        command: 'threads.list',
        page: listing.page,
        scope: { actorUserId: 'actual-actor', workspaceId: null },
      },
      expect.any(AbortSignal)
    )
  })
  it('refuses missing authentication before local execution', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await post(listing)).status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each([
    { scope: { actorUserId: 'foreign', workspaceId: null } },
    { financialBinding: {} },
    { protocolRevision: 'retired' },
  ])('refuses browser-authored trusted envelope fields %j', async (extra) => {
    expect((await post({ ...listing, ...extra })).status).toBe(422)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('processes contexts and preserves model/access selection without an external manifest', async () => {
    const body = {
      command: 'message',
      requestId: 'request',
      workspaceId: 'workspace',
      model: 'test/model',
      input: { content: 'hello', contexts: [] },
      accessLevel: 'full',
      stream: true,
    }
    expect((await post(body)).status).toBe(200)
    const command = mocks.execute.mock.calls[0]![0]
    expect(command).toMatchObject({
      accessLevel: 'full',
      model: 'test/model',
      scope: { actorUserId: 'actual-actor', workspaceId: 'workspace' },
      input: { content: 'hello', contexts: [] },
    })
    expect(command).not.toHaveProperty('workspaceId')
    expect(command).not.toHaveProperty('toolManifest')
  })
  it('checks workflow context belongs to the selected workspace before execution', async () => {
    expect(
      (
        await post({
          command: 'message',
          requestId: 'request',
          workspaceId: 'other',
          model: 'test/model',
          workflowId: 'workflow',
          input: { content: 'hello' },
          stream: true,
        })
      ).status
    ).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('transports a review decision without accepting business payloads from the browser', async () => {
    const body = {
      requestId: 'request',
      workspaceId: null,
      command: 'tool.execute',
      target: {
        threadId: 'thread',
        resourceId: 'resource',
        runId: 'run',
        toolCallId: 'call',
        toolName: 'edit_workflow',
      },
      action: 'review.accept',
      reviewToken: 'preview',
      stream: true,
    }
    expect((await post(body)).status).toBe(200)
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({
      action: 'review.accept',
      reviewToken: 'preview',
    })
    mocks.execute.mockClear()
    expect((await post({ ...body, result: { success: true }, originalArgs: {} })).status).toBe(422)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('validates and persists separate dashboard and saved-entity contexts', async () => {
    const contexts = [
      {
        kind: 'current_dashboard_layout',
        dashboardLayoutId: 'layout-a',
        workspaceId: 'workspace-a',
        ownerUserId: 'actual-actor',
        label: 'Current',
      },
      { kind: 'watchlist', watchlistId: 'watchlist-b', workspaceId: 'workspace-b', label: 'B' },
    ]
    const toolContexts = [
      {
        contextEntityKind: 'dashboard_layout',
        contextEntityId: 'layout-a',
        workspaceId: 'workspace-a',
      },
      {
        contextEntityKind: 'watchlist',
        contextEntityId: 'watchlist-b',
        workspaceId: 'workspace-b',
      },
    ]
    expect(
      (
        await post({
          command: 'message',
          requestId: 'request',
          workspaceId: null,
          model: 'test/model',
          input: { content: 'Read both', contexts },
          toolContext: toolContexts[1],
          toolContexts,
          stream: true,
        })
      ).status
    ).toBe(200)
    expect(mocks.entity).toHaveBeenCalledTimes(2)
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({
      toolContexts,
      toolContext: toolContexts[1],
    })
  })
  it('refuses an execution-context hint absent from the submitted context list', async () => {
    expect(
      (
        await post({
          command: 'message',
          requestId: 'request',
          workspaceId: null,
          model: 'test/model',
          input: { content: 'Read' },
          toolContexts: [{ contextEntityKind: 'workflow', contextEntityId: 'hidden' }],
          stream: true,
        })
      ).status
    ).toBe(422)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
