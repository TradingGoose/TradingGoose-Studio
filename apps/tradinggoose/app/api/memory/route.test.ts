import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowMemoryError } from '@/lib/mastra/errors'
import { MemoryBlock } from '@/blocks/blocks/memory'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
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
vi.unmock('@/blocks/registry')
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/auth/internal', () => ({ generateInternalToken: async () => 'internal-token' }))
vi.mock('@/lib/mastra/workflow-memory', () => ({
  getAllWorkflowMemory: mocks.list,
  getWorkflowMemory: mocks.get,
  appendWorkflowMemory: mocks.append,
  deleteWorkflowMemory: mocks.delete,
}))
const key = 'chat/1'
const messages = [{ role: 'user', content: 'Hello' }]
const record = { key, type: 'agent', data: messages }
const request = (method: string, data?: unknown, query = 'workflowId=workflow-1') =>
  new NextRequest(`http://localhost/api/memory/${encodeURIComponent(key)}?${query}`, {
    method,
    ...(data
      ? { body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }
      : {}),
  })
const context = { params: Promise.resolve({ id: key }) }
const readOperations = [
  ['get', GET_BY_ID, mocks.get, messages],
  ['getAll', GET, mocks.list, [record]],
  ['delete', DELETE, mocks.delete, undefined],
] as const
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ success: true, userId: 'user-1' })
  mocks.get.mockResolvedValue(record)
  mocks.list.mockResolvedValue([record])
})
describe('four native Memory product operations', () => {
  it.each([
    { content: 'Hello', created: false },
    { content: '', created: true },
  ])(
    'preserves Add content "$content" through the route and response adapter (created=$created)',
    async ({ content, created }) => {
      const message = { role: 'user', content }
      mocks.append.mockResolvedValue({ created, record: { ...record, data: [message] } })
      const body = memoryAddTool.request.body!({
        id: key,
        ...message,
        _context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
      })
      const response = await POST(request('POST', body))
      expect(response.status).toBe(created ? 201 : 200)
      expect(await memoryAddTool.transformResponse!(response)).toEqual({
        success: true,
        output: { memories: [message] },
      })
      expect(mocks.append).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'workflow-1',
        key,
        message,
        expect.any(AbortSignal)
      )
    }
  )
  it('rejects missing workflow context and identifiers before Add transport', () => {
    const buildBody = memoryAddTool.request.body!
    expect(() => buildBody({ id: key, workflowId: 'untrusted' })).toThrow('workflowId is required')
    expect(() => buildBody({ _context: { workflowId: 'workflow-1' } })).toThrow('id is required')
  })
  it.each(readOperations)(
    'executes Memory %s through the generic handler, shared runner and route',
    async (operation, handler, storage, memories) => {
      const transport = vi.fn(async (input: string, init?: RequestInit) => {
        const req = new NextRequest(new Request(input, init))
        expect(req.nextUrl.pathname).toBe(
          operation === 'getAll' ? '/api/memory' : '/api/memory/chat%2F1'
        )
        expect(req.method).toBe(operation === 'delete' ? 'DELETE' : 'GET')
        expect(Object.fromEntries(req.nextUrl.searchParams)).toEqual({
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
        })
        expect(req.headers.get('Authorization')).toBe('Bearer internal-token')
        return handler(req, context)
      })
      vi.stubGlobal('fetch', transport)
      const execution = {
        ...createMockContext({ workflowId: 'workflow-1', workspaceId: 'workspace-1' }),
        userId: 'user-1',
      }
      const block = {
        ...createMinimalWorkflow().blocks[1],
        metadata: { id: 'memory' },
        config: { tool: MemoryBlock.tools.config!.tool({ operation }), params: {} },
      }
      const result = await new GenericBlockHandler().execute(
        block,
        {
          operation,
          id: key,
          workflowId: 'untrusted',
          workspaceId: 'untrusted',
          _context: { workflowId: 'untrusted', workspaceId: 'untrusted', userId: 'untrusted' },
        },
        execution
      )
      expect(result.memories).toEqual(memories)
      expect(transport).toHaveBeenCalledOnce()
      expect(storage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        'workflow-1',
        ...(operation === 'getAll' ? [] : [key]),
        expect.any(AbortSignal)
      )
    }
  )
  it.each(readOperations)(
    'validates scope and authentication before %s storage access',
    async (operation, handler, storage) => {
      const method = operation === 'delete' ? 'DELETE' : 'GET'
      for (const query of ['', 'workflowId=%20', 'workflowId=workflow-1&workspaceId=%20'])
        expect((await handler(request(method, undefined, query), context)).status).toBe(400)
      mocks.auth.mockResolvedValueOnce({ success: false })
      expect((await handler(request(method), context)).status).toBe(401)
      expect(storage).not.toHaveBeenCalled()
      expect((await handler(request(method), context)).status).toBe(200)
    }
  )
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
  it('returns missing-memory errors', async () => {
    mocks.get.mockRejectedValueOnce(new WorkflowMemoryError('Memory not found', 404))
    const response = await GET_BY_ID(request('GET'), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      success: false,
      error: { message: 'Memory not found' },
    })
  })
})
