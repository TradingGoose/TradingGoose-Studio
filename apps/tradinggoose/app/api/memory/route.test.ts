import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryAddTool } from '@/tools/memory/add'
import { DELETE, GET as GET_BY_ID, PUT } from './[id]/route'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  scope: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  values: vi.fn(),
  conflict: vi.fn(),
  returning: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  set: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: mocks.scope }))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
  },
}))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

const messages = [{ role: 'user', content: 'Hello' }]
const request = (method: string, data?: unknown) =>
  new NextRequest('http://localhost/api/memory/chat?workflowId=workflow-1', {
    method,
    ...(data
      ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
const context = { params: Promise.resolve({ id: 'chat' }) }
const updateBody = { workflowId: 'workflow-1', data: messages[0] }
const toolBody = () =>
  memoryAddTool.request.body!({
    id: 'chat',
    role: 'user',
    content: 'Hello',
    _context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ success: true, userId: 'user-1' })
  mocks.scope.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
  })
  mocks.limit.mockResolvedValue([{ id: 'mem-existing', data: messages }])
  mocks.returning.mockResolvedValue([{ id: 'mem-existing', data: messages }])
  mocks.where.mockReturnValue({
    limit: mocks.limit,
    orderBy: () => ({ limit: mocks.limit }),
    returning: mocks.returning,
  })
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) })
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.conflict })
  mocks.conflict.mockReturnValue({ returning: mocks.returning })
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.delete.mockReturnValue({ where: mocks.where })
})

describe('Memory persistence endpoints', () => {
  it('accepts the actual Add tool payload and returns persisted messages', async () => {
    const response = await POST(request('POST', toolBody()))
    expect(response.status).toBe(200)
    expect(mocks.scope).toHaveBeenCalledWith(
      { success: true, userId: 'user-1' },
      'workflow-1',
      'write'
    )
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        key: 'chat',
        type: 'agent',
        data: messages,
      })
    )
    expect(await memoryAddTool.transformResponse!(response)).toEqual({
      success: true,
      output: { memories: messages },
    })
  })

  it('appends atomically on the workflow/key conflict without a read-then-write race', async () => {
    await POST(request('POST', toolBody()))
    const config = mocks.conflict.mock.calls[0][0]
    const compiled = new PgDialect().sqlToQuery(config.set.data)
    expect(config.target.map((column: { name: string }) => column.name)).toEqual([
      'workflow_id',
      'key',
    ])
    expect(compiled.sql).toContain('::jsonb ||')
    expect(compiled.params).toContain(JSON.stringify(messages))
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 201 for a newly inserted memory', async () => {
    mocks.returning.mockImplementation(async () => [mocks.values.mock.calls[0][0]])
    expect((await POST(request('POST', toolBody()))).status).toBe(201)
  })

  it('does not revive deleted or non-agent records', async () => {
    mocks.returning.mockResolvedValue([])
    expect((await POST(request('POST', toolBody()))).status).toBe(409)
    const guard = new PgDialect().sqlToQuery(mocks.conflict.mock.calls[0][0].setWhere)
    expect(guard.sql).toContain('deleted_at')
    expect(guard.params).toContain('agent')
  })

  it.each(['POST', 'PUT'])('validates role/content and workflow scope for %s', async (method) => {
    const data = { ...(toolBody() as object), data: { role: 'invalid', content: '' } }
    const response =
      method === 'POST'
        ? await POST(request(method, data))
        : await PUT(request(method, data), context)
    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('uses update, not delete, to replace an existing conversation message', async () => {
    const response = await PUT(request('PUT', updateBody), context)
    expect(response.status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith({ data: messages, updatedAt: expect.any(Date) })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('keeps the default listing limit of 50 and validates explicit limits', async () => {
    expect((await GET(request('GET'))).status).toBe(200)
    expect(mocks.limit).toHaveBeenCalledWith(50)
    expect(
      (await GET(new NextRequest('http://localhost/api/memory?workflowId=workflow-1&limit=-1')))
        .status
    ).toBe(400)
  })

  it.each([
    ['list', () => GET(request('GET'))],
    ['get', () => GET_BY_ID(request('GET'), context)],
    ['post', () => POST(request('POST', toolBody()))],
    ['put', () => PUT(request('PUT', updateBody), context)],
    ['delete', () => DELETE(request('DELETE'), context)],
  ] as const)('rejects unauthorized %s before persistence access', async (_operation, invoke) => {
    mocks.auth.mockResolvedValue({ success: false })
    mocks.scope.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })
    const response = await invoke()
    expect(response.status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('denies writes from a read-only workspace user', async () => {
    mocks.scope.mockResolvedValue({ ok: false, error: 'Workflow access denied', status: 403 })
    expect((await POST(request('POST', toolBody()))).status).toBe(403)
    expect((await DELETE(request('DELETE'), context)).status).toBe(403)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })
})
