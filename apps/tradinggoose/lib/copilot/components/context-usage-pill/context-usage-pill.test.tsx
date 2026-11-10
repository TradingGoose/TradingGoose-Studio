/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { COPILOT_NATIVE_REVISION, type ContextResponse } from '@/lib/copilot/native/contract'
import { ContextUsagePill } from './context-usage-pill'

let root: Root
let container: HTMLDivElement
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const evidence: ContextResponse = {
  protocolRevision: COPILOT_NATIVE_REVISION,
  requestId: 'context-fixture',
  status: 'context',
  threadId: 'thread-fixture',
  contextTokens: null,
  tokenSource: 'unavailable',
}
const render = (
  context: ContextResponse,
  onCompact = vi.fn(async () => {}),
  onCreateNewChat = vi.fn()
) =>
  act(async () =>
    root.render(
      <TooltipProvider>
        <ContextUsagePill
          evidence={context}
          onCompact={onCompact}
          onCreateNewChat={onCreateNewChat}
        />
      </TooltipProvider>
    )
  )
const compact = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Compact native context"]')!
beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  environment.IS_REACT_ACT_ENVIRONMENT = false
})

it.each(['unavailable', 'context_estimate', 'active_native_usage'] as const)(
  'offers explicit pruning with %s evidence and no observation flag or capacity claim',
  async (tokenSource) => {
    const onCompact = vi.fn(async () => {})
    await render(
      { ...evidence, tokenSource, contextTokens: tokenSource === 'unavailable' ? null : 1234 },
      onCompact
    )
    expect(compact()).not.toBeNull()
    expect(container.textContent).not.toContain('%')
    await act(async () => compact().click())
    expect(onCompact).toHaveBeenCalledTimes(1)
  }
)
it('disables the explicit action only while its existing callback is pending', async () => {
  let finish!: () => void
  const completion = new Promise<void>((resolve) => {
    finish = resolve
  })
  const onCompact = vi.fn(() => completion)
  await render(evidence, onCompact)
  await act(async () => compact().click())
  expect(compact().disabled).toBe(true)
  await act(async () => finish())
  expect(compact().disabled).toBe(false)
  expect(onCompact).toHaveBeenCalledTimes(1)
})
it('shows an actual pruning refusal and restores the action without automatic retry', async () => {
  const onCompact = vi.fn(async () => {
    throw new Error('Native pruning refused')
  })
  await render(evidence, onCompact)
  await act(async () => compact().click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Native pruning refused')
  expect(compact().disabled).toBe(false)
  expect(onCompact).toHaveBeenCalledTimes(1)
})
it('keeps create-new-chat separate from pruning', async () => {
  const onCompact = vi.fn(async () => {})
  const onCreateNewChat = vi.fn()
  await render(evidence, onCompact, onCreateNewChat)
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Create new chat"]')!.click()
  )
  expect(onCreateNewChat).toHaveBeenCalledTimes(1)
  expect(onCompact).not.toHaveBeenCalled()
})
