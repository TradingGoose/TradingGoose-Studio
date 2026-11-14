/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_COPILOT_REQUEST_BYTES } from '@/lib/copilot/native/request-size'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  scope: vi.fn(),
  execute: vi.fn(),
  workflow: vi.fn(),
  entity: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/copilot/agent/service', () => ({ executeCopilotCommand: mocks.execute }))
vi.mock('@/lib/copilot/native/target', () => ({
  authorizeNativeConversationScope: mocks.scope,
}))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: mocks.entity,
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.workflow }))
const listing = {
  workspaceId: null,
  command: 'threads.list',
}
async function post(body: unknown) {
  return postRaw(JSON.stringify(body))
}
async function postRaw(body: string | ReadableStream<Uint8Array>, headers?: HeadersInit) {
  const { POST } = await import('./route')
  return POST(
    new NextRequest('https://studio.test/api/copilot/native', {
      method: 'POST',
      body,
      headers,
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
  mocks.workflow.mockResolvedValue({ ok: true, workspaceId: 'workspace' })
  mocks.entity.mockImplementation(async (context) => ({
    workspaceId: context.workspaceId ?? 'resolved-workspace',
  }))
})

describe('Copilot raw request size boundary', () => {
  it('refuses a declared oversized body before reading truncated JSON or resolving scope', async () => {
    const response = await postRaw('{"command":', {
      'content-length': String(MAX_COPILOT_REQUEST_BYTES + 1),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      status: 'refused',
      error: { code: 'INVALID_REQUEST', message: expect.stringContaining('10 MiB') },
    })
    expect(mocks.scope).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('requires authentication before inspecting an oversized request', async () => {
    mocks.session.mockResolvedValue(null)
    expect(
      (
        await postRaw('{', {
          'content-length': String(MAX_COPILOT_REQUEST_BYTES + 1),
        })
      ).status
    ).toBe(401)
    expect(mocks.scope).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([undefined, '1'])(
    'checks actual raw bytes when content-length is %s, including JSON whitespace',
    async (declaredLength) => {
      const json = JSON.stringify(listing)
      const body = json + ' '.repeat(MAX_COPILOT_REQUEST_BYTES + 1 - json.length)
      const response = await postRaw(
        body,
        declaredLength === undefined ? undefined : { 'content-length': declaredLength }
      )
      expect(response.status).toBe(413)
      expect(mocks.scope).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it.each([
    { label: 'one 8 MiB image', sizes: [8] },
    { label: 'two 4 MiB images', sizes: [4, 4] },
  ])('refuses $label after base64 encoding before model dispatch', async ({ sizes }) => {
    const content = sizes.map((size) => ({
      type: 'image',
      mediaType: 'image/png',
      image: `data:image/png;base64,${Buffer.alloc(size * 1024 * 1024).toString('base64')}`,
    }))
    const response = await post({
      command: 'message',
      workspaceId: null,
      model: 'test/model',
      input: { content },
    })
    expect(response.status).toBe(413)
    expect(mocks.scope).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('counts UTF-8 context, escaped prompt and JSON overhead with aggregate images', async () => {
    const image = {
      type: 'image',
      mediaType: 'image/png',
      image: `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString('base64')}`,
    }
    const body = JSON.stringify({
      command: 'message',
      workspaceId: null,
      model: 'test/model',
      input: {
        content: [{ type: 'text', text: 'Describe "both"\\\n🦆' }, image, image],
        contexts: [{ kind: 'docs', label: '🦆'.repeat((1024 * 1024) / 2) }],
      },
    })
    expect(body.length).toBeLessThan(MAX_COPILOT_REQUEST_BYTES)
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_COPILOT_REQUEST_BYTES)
    expect((await postRaw(body)).status).toBe(413)
    expect(mocks.scope).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('accepts a valid body exactly at the shared byte limit', async () => {
    const json = JSON.stringify(listing)
    const body = json + ' '.repeat(MAX_COPILOT_REQUEST_BYTES - json.length)
    expect((await postRaw(body)).status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      listing,
      'actual-actor',
      expect.any(AbortSignal),
      []
    )
  })

  it.each(['{"command":', '{"command":"threads.list"'])(
    'refuses malformed or truncated JSON without dispatch: %s',
    async (body) => {
      expect((await postRaw(body)).status).toBe(422)
      expect(mocks.scope).not.toHaveBeenCalled()
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )

  it('preserves UTF-8 prompt text split across streamed chunks', async () => {
    const body = {
      command: 'message',
      workspaceId: null,
      model: 'test/model',
      input: { content: 'Describe 🦆' },
    }
    const encoded = new TextEncoder().encode(JSON.stringify(body))
    const split = encoded.indexOf(0xf0) + 1
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, split))
        controller.enqueue(encoded.slice(split))
        controller.close()
      },
    })
    expect((await postRaw(stream)).status).toBe(200)
    expect(mocks.execute.mock.calls[0][0]).toEqual(body)
  })
})
describe('built-in Copilot authenticated boundary', () => {
  it('calls the local service with authenticated actor and explicit conversation scope', async () => {
    expect((await post(listing)).status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(
      {
        command: 'threads.list',
        workspaceId: null,
      },
      'actual-actor',
      expect.any(AbortSignal),
      []
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
    { apiKey: 'caller-key' },
  ])('refuses browser-authored trusted envelope fields %j', async (extra) => {
    expect((await post({ ...listing, ...extra })).status).toBe(422)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('processes contexts and preserves model/access selection without an external manifest', async () => {
    const body = {
      command: 'message',
      workspaceId: 'workspace',
      model: 'test/model',
      input: { content: 'hello', contexts: [] },
      accessLevel: 'full',
    }
    expect((await post(body)).status).toBe(200)
    const command = mocks.execute.mock.calls[0]![0]
    expect(command).toMatchObject({
      accessLevel: 'full',
      model: 'test/model',
      workspaceId: 'workspace',
      input: { content: 'hello', contexts: [] },
    })
    expect(command).not.toHaveProperty('scope')
    expect(command).not.toHaveProperty('toolManifest')
  })
  it('checks workflow context belongs to the selected workspace before execution', async () => {
    expect(
      (
        await post({
          command: 'message',
          workspaceId: 'other',
          model: 'test/model',
          workflowId: 'workflow',
          input: { content: 'hello' },
        })
      ).status
    ).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('transports a review decision without accepting business payloads from the browser', async () => {
    const body = {
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
    }
    expect((await post(body)).status).toBe(200)
    expect(mocks.execute.mock.calls[0]![0]).toMatchObject({
      action: 'review.accept',
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
          workspaceId: null,
          model: 'test/model',
          input: { content: 'Read both', contexts },
          toolContext: toolContexts[1],
        })
      ).status
    ).toBe(200)
    expect(mocks.entity).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ toolContext: toolContexts[1] }),
      'actual-actor',
      expect.any(AbortSignal),
      toolContexts
    )
    expect(mocks.execute.mock.calls[0]![0]).not.toHaveProperty('toolContexts')
  })
  it.each([
    { toolContexts: [{ contextEntityKind: 'workflow', contextEntityId: 'hidden' }] },
    { toolContext: { contextEntityKind: 'workflow', contextEntityId: 'hidden' } },
  ])(
    'refuses browser-authored tool authority absent from the submitted contexts: %j',
    async (extra) => {
      expect(
        (
          await post({
            command: 'message',
            workspaceId: null,
            model: 'test/model',
            input: { content: 'Read' },
            ...extra,
          })
        ).status
      ).toBe(422)
      expect(mocks.execute).not.toHaveBeenCalled()
    }
  )
})

it('preserves ordered native text and image content through authenticated ingress', async () => {
  const content = [
    { type: 'text', text: 'First image' },
    { type: 'image', image: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png' },
    { type: 'text', text: 'Second image' },
    { type: 'image', image: 'data:image/jpeg;base64,d29ybGQ=', mediaType: 'image/jpeg' },
  ]
  expect(
    (
      await post({
        command: 'message',
        workspaceId: 'workspace',
        model: 'test/model',
        input: { content },
      })
    ).status
  ).toBe(200)
  expect(mocks.execute).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'workspace', input: { content } }),
    'actual-actor',
    expect.any(AbortSignal),
    []
  )
})

it('rejects remote image locators before context resolution or model execution', async () => {
  expect(
    (
      await post({
        command: 'message',
        workspaceId: null,
        model: 'test/model',
        input: {
          content: [
            { type: 'image', image: 'https://private.test/source', mediaType: 'image/png' },
          ],
        },
      })
    ).status
  ).toBe(422)
  expect(mocks.execute).not.toHaveBeenCalled()
})

it.each([false, true])(
  'retains original mention labels and UI locators (images: %s)',
  async (images) => {
    const contexts = [{ kind: 'workflow', workflowId: 'workflow-id', label: 'My workflow' }]
    const text = 'Explain @My workflow'
    const content = images
      ? [
          { type: 'text', text },
          { type: 'image', image: 'data:image/png;base64,aGVsbG8=', mediaType: 'image/png' },
        ]
      : text
    expect(
      (
        await post({
          command: 'message',
          workspaceId: 'workspace',
          model: 'test/model',
          input: { content, contexts },
        })
      ).status
    ).toBe(200)
    expect(mocks.execute.mock.calls[0][0].input).toEqual({ content, contexts })
  }
)
