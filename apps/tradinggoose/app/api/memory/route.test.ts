import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowMemoryError } from '@/lib/mastra/errors'
import { memoryAddTool } from '@/tools/memory/add'
import { DELETE, GET as GET_BY_ID } from './[id]/route'
import { GET, POST } from './route'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  append: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/mastra/workflow-memory', () => ({
  getAllWorkflowMemory: mocks.list,
  getWorkflowMemory: mocks.get,
  appendWorkflowMemory: mocks.append,
  deleteWorkflowMemory: mocks.delete,
}))
vi.mock('@/lib/logs/console/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))
const messages = [{ role: 'user', content: 'Hello' }]
const request = (method: string, data?: unknown, query = 'workflowId=workflow-1') =>
  new NextRequest(`http://localhost/api/memory/chat?${query}`, {
    method,
    ...(data
      ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
const context = { params: Promise.resolve({ id: 'chat' }) }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ success: true, userId: 'user-1' })
  mocks.append.mockResolvedValue({
    created: false,
    record: { key: 'chat', type: 'agent', data: messages },
  })
  mocks.get.mockResolvedValue({ key: 'chat', type: 'agent', data: messages })
  mocks.list.mockResolvedValue([{ key: 'chat', type: 'agent', data: messages }])
})
describe('four native Memory product operations', () => {
  it('accepts the actual Add adapter and returns complete persisted messages', async () => {
    const body = memoryAddTool.request.body!({
      id: 'chat',
      role: 'user',
      content: 'Hello',
      _context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    })
    const response = await POST(request('POST', body))
    expect(response.status).toBe(200)
    expect((await response.json()).data.data).toEqual(messages)
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'workflow-1',
      'chat',
      messages[0],
      expect.any(AbortSignal)
    )
  })
  it('accepts a literal empty-string entry through the actual Add request adapter', async () => {
    const body = memoryAddTool.request.body!({
      id: 'chat',
      role: 'user',
      content: '',
      _context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    })
    mocks.append.mockResolvedValue({
      created: true,
      record: { key: 'chat', type: 'agent', data: [{ role: 'user', content: '' }] },
    })
    const response = await POST(request('POST', body))
    expect(response.status).toBe(201)
    expect((await response.json()).data.data).toEqual([{ role: 'user', content: '' }])
    expect(mocks.append.mock.calls[0][3]).toEqual({ role: 'user', content: '' })
  })
  it('gets current complete conversation, lists fixed50 logical contract and deletes', async () => {
    expect((await GET_BY_ID(request('GET'), context)).status).toBe(200)
    expect((await GET(request('GET'))).status).toBe(200)
    expect((await DELETE(request('DELETE'), context)).status).toBe(200)
    expect(mocks.get).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      'chat',
      expect.any(AbortSignal)
    )
    expect(mocks.list).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      expect.any(AbortSignal)
    )
  })
  it('rejects retired list options, invalid roles and nonstring content before native IO', async () => {
    for (const query of [
      'workflowId=workflow-1&limit=1',
      'workflowId=workflow-1&type=agent',
      'workflowId=workflow-1&query=x',
    ])
      expect((await GET(request('GET', undefined, query))).status).toBe(400)
    for (const data of [
      { role: 'tool', content: 'x' },
      { role: 'user', content: null },
    ])
      expect(
        (
          await POST(
            request('POST', { key: 'chat', type: 'agent', workflowId: 'workflow-1', data })
          )
        ).status
      ).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.append).not.toHaveBeenCalled()
  })
  it('returns authentication and missing-memory errors', async () => {
    mocks.auth.mockResolvedValueOnce({ success: false })
    expect((await GET(request('GET'))).status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.get.mockRejectedValueOnce(new WorkflowMemoryError('Memory not found', 404))
    const response = await GET_BY_ID(request('GET'), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'Memory not found' },
    })
  })
})
