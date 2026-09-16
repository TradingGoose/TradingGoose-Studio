import { describe, expect, it, vi } from 'vitest'

vi.mock('@/tools/schema-enrichers', () => ({ enrichKBTagFiltersSchema: vi.fn() }))

import { knowledgeSearchTool } from './search'

describe('Knowledge Search API request contract', () => {
  it.each([undefined, 'how to authenticate'])('sends canonical filters with query %s', (query) => {
    const body = knowledgeSearchTool.request.body!({
      knowledgeBaseId: 'kb-1',
      query,
      tagFilters: JSON.stringify([{ tagName: 'category', tagValue: 'api' }]),
      workflowId: 'untrusted',
      _context: { workflowId: 'workflow-1' },
    })
    expect(body).toEqual({
      knowledgeBaseIds: ['kb-1'],
      query,
      filters: { category: 'api' },
      topK: 10,
      workflowId: 'workflow-1',
    })
    expect(body).not.toHaveProperty('tagFilters')
  })

  it('does not manufacture filters for an empty editor value', () => {
    expect(
      knowledgeSearchTool.request.body!({
        knowledgeBaseId: 'kb-1',
        query: 'query',
        tagFilters: null,
      })
    ).not.toHaveProperty('filters')
  })
})
