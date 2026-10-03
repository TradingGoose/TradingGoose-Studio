/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowCheckpointView } from '@/lib/workflows/human-in-the-loop/types'
import { WorkflowReview } from './review'

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const fetchMock = vi.fn()
const review = (): WorkflowCheckpointView & { canSubmit: boolean } => ({
  workflowId: 'workflow',
  executionId: 'execution',
  revision: 1,
  status: 'paused',
  canSubmit: true,
  pausePoints: [
    {
      id: 'approval',
      blockId: 'approval',
      blockName: 'Approval',
      kind: 'human',
      displayData: {},
      inputFormat: [
        { name: 'amount', type: 'number', required: true },
        { name: 'approved', type: 'boolean', value: false },
        { name: 'details', type: 'object', value: { note: 'review' } },
        { name: 'optional', type: 'string' },
      ],
    },
  ],
})
let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
const renderReview = async (data: ReturnType<typeof review> | null = review()) => {
  if (data) queryClient.setQueryData(['workflow-review', 'workflow', 'execution'], data)
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkflowReview workflowId='workflow' executionId='execution' />
      </QueryClientProvider>
    )
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  vi.unstubAllGlobals()
})

describe('Workflow review form', () => {
  it.each([
    ['.5', 0.5],
    ['01', 1],
  ])(
    'submits numeric text %s with boolean/JSON defaults and no empty optional field',
    async (text, amount) => {
      fetchMock.mockResolvedValueOnce(Response.json({ ...review(), status: 'queued' }))
      await renderReview()
      act(() => {
        const input = container.querySelector('input')!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        revision: 1,
        pausePointId: 'approval',
        input: { amount, approved: false, details: { note: 'review' } },
      })
    }
  )

  it('provides a child review link while keeping the parent blocked', async () => {
    const data = review()
    data.pausePoints = [
      {
        id: 'child',
        blockId: 'child',
        blockName: 'Child',
        kind: 'child',
        displayData: {},
        inputFormat: [],
        childWorkflowId: 'child/workflow',
        childExecutionId: 'child/execution',
      },
    ]
    await renderReview(data)
    const link = container.querySelector('a')!
    expect(link.textContent).toBe('Open child review')
    expect(link.getAttribute('href')).toBe('/resume/child%2Fworkflow/child%2Fexecution')
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })

  it.each([false, true])('loads workspace review permissions: canSubmit=%s', async (canSubmit) => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...review(), canSubmit }))
    await renderReview(null)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/resume/workflow/execution', { cache: 'no-store' })
    expect(container.querySelector('button[type="submit"]')!.hasAttribute('disabled')).toBe(
      !canSubmit
    )
  })

  it('does not allow another submission for an already-submitted pause point', async () => {
    const data = review()
    data.pausePoints[0].input = { amount: 0 }
    await renderReview(data)
    expect(container.textContent).toContain('Submitted')
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })
})
