/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrozenCanvas } from './frozen-canvas'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/app/workspace/[workspaceId]/components/workflow-preview/workflow-preview', () => ({
  WorkflowPreview: ({ onNodeClick }: { onNodeClick: (id: string) => void }) => (
    <button type='button' onClick={() => onNodeClick('block-1')}>
      Inspect block
    </button>
  ),
}))

describe('frozen execution cost details', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ workflowState: { blocks: { 'block-1': { name: 'Agent' } } } }),
      })
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function inspect(cost: Record<string, unknown>) {
    await act(async () => {
      root.render(
        <FrozenCanvas
          executionId='run-1'
          traceSpans={[
            {
              id: 'span-1',
              blockId: 'block-1',
              name: 'Agent',
              type: 'agent',
              status: 'success',
              cost,
            },
          ]}
        />
      )
    })
    await act(async () => {
      container.querySelector('button')!.click()
    })
    return container.textContent
  }

  it('keeps missing input/output allocations unavailable for a reported total', async () => {
    const text = await inspect({ total: 0.004, status: 'reported' })
    expect(text).toContain('Input:Unavailable')
    expect(text).toContain('Output:Unavailable')
    expect(text).toContain('Total:$0.0040')
    expect(text).not.toContain('Input:$0')
  })

  it('shows partial status and the actual available subtotal', async () => {
    const text = await inspect({ availableTotal: 0.002, status: 'partial', estimated: true })
    expect(text).toContain('Estimated Unavailable (partial)')
    expect(text).toContain('Available subtotal:$0.0020')
  })

  it('renders genuine zero totals', async () => {
    expect(await inspect({ total: 0, status: 'reported' })).toContain('Total:$0')
  })

  it('renders an unavailable native cost without fabricating zero', async () => {
    const text = await inspect({ status: 'unavailable' })
    expect(text).toContain('Total:Unavailable')
    expect(text).not.toContain('Total:$0')
  })
})
