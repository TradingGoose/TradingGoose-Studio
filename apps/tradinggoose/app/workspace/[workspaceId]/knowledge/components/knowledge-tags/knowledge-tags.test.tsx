/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'
import { KnowledgeTags } from './knowledge-tags'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const tagMocks = vi.hoisted(() => ({
  definitions: [] as Array<Record<string, unknown>>,
  nextSlot: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
}))
vi.mock('@/hooks/use-knowledge-base-tag-definitions', () => ({
  useKnowledgeBaseTagDefinitions: () => ({
    tagDefinitions: tagMocks.definitions,
    fetchTagDefinitions: tagMocks.refresh,
  }),
}))
vi.mock('@/hooks/use-next-available-slot', () => ({
  useNextAvailableSlot: () => ({ getNextAvailableSlot: tagMocks.nextSlot }),
}))
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const documentFixture = (tags: Partial<DocumentData> = {}): DocumentData => ({
  id: 'document-1',
  knowledgeBaseId: 'knowledge-1',
  filename: 'document.txt',
  fileUrl: '/document.txt',
  fileSize: 1,
  mimeType: 'text/plain',
  chunkCount: 0,
  tokenCount: 0,
  characterCount: 0,
  processingStatus: 'completed',
  enabled: true,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  ...tags,
})

const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status })

const setInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const setDocument = (document: DocumentData) =>
  useKnowledgeStore.setState({
    documents: {
      'knowledge-1': {
        documents: [document],
        pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
        lastFetchTime: Date.now(),
      },
    },
  })

describe('KnowledgeTags definition settlement', () => {
  let container: HTMLDivElement
  let root: Root
  let postResponse: Promise<Response>
  const documentPuts: Array<Record<string, string>> = []

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    documentPuts.length = 0
    tagMocks.definitions = []
    tagMocks.nextSlot.mockReset().mockResolvedValue('tag1')
    tagMocks.refresh.mockReset().mockResolvedValue(undefined)
    setDocument(documentFixture())
    postResponse = Promise.resolve(
      jsonResponse({ success: true, data: { created: [], updated: [], errors: [] } })
    )
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') return postResponse
      if (init?.method === 'PUT') {
        documentPuts.push(JSON.parse(String(init.body)) as Record<string, string>)
        return jsonResponse({ success: true })
      }
      if (url.endsWith('/tag-definitions')) {
        return jsonResponse({ success: true, data: tagMocks.definitions })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const button = (label: string) =>
    [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label
    )!

  const input = (placeholder: string) =>
    container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!

  const renderAndOpenCreator = async () => {
    await act(async () => {
      root.render(<KnowledgeTags knowledgeBaseId='knowledge-1' documentId='document-1' />)
    })
    await vi.waitFor(() => expect(button('Add Tag')).toBeTruthy())
    act(() => button('Add Tag').click())
    const name = input('Enter tag name')
    const value = input('Enter tag value')
    act(() => {
      setInput(name, 'Risk')
      setInput(value, 'High')
    })
    return { name, value }
  }

  it('keeps the form busy and intact when a successful envelope contains errors', async () => {
    let resolvePost!: (response: Response) => void
    postResponse = new Promise((resolve) => {
      resolvePost = resolve
    })
    const { name, value } = await renderAndOpenCreator()
    const submit = button('Create New Tag')
    act(() => submit.click())
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy())
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
    expect(submit).toBeDisabled()
    act(() =>
      resolvePost(
        jsonResponse({
          success: true,
          data: { created: [], updated: [], errors: ['Tag slot conflict'] },
        })
      )
    )
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy())
    expect(name.value).toBe('Risk')
    expect(value.value).toBe('High')
    expect(documentPuts).toHaveLength(0)
  })

  it('uses the returned slot and closes only after document settlement', async () => {
    postResponse = Promise.resolve(
      jsonResponse({
        success: true,
        data: {
          created: [{ id: 'definition-1', tagSlot: 'tag2' }],
          updated: [],
          errors: [],
        },
      })
    )
    await renderAndOpenCreator()
    const submit = button('Create New Tag')
    act(() => submit.click())
    await vi.waitFor(() =>
      expect(container.querySelector('[role="status"]')).toHaveTextContent('Tag saved')
    )
    expect(documentPuts).toHaveLength(1)
    expect(documentPuts[0]).toMatchObject({ tag1: '', tag2: 'High' })
    expect(container.querySelector('input[placeholder="Enter tag name"]')).toBeNull()
  })

  it('associates duplicate-name validation and prevents submission', async () => {
    const definition = {
      id: 'definition-1',
      tagSlot: 'tag1',
      displayName: 'Existing',
      fieldType: 'text',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    tagMocks.definitions = [definition]
    setDocument(documentFixture({ tag1: 'Value' }))
    await renderAndOpenCreator()
    const name = input('Enter tag name')
    act(() => setInput(name, 'Existing'))
    await vi.waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    const errorId = name.getAttribute('aria-describedby')
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent('already exists')
    expect(button('Create New Tag')).toBeDisabled()
    expect(documentPuts).toHaveLength(0)
  })
})
