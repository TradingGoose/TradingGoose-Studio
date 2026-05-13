/**
 * @vitest-environment jsdom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResolvedReviewTarget } from './use-resolved-review-target'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockResolveEntityReviewTarget = vi.fn()

vi.mock('@/widgets/widgets/entity_review/review-target-utils', async () => {
  const actual = await vi.importActual<
    typeof import('@/widgets/widgets/entity_review/review-target-utils')
  >('@/widgets/widgets/entity_review/review-target-utils')

  return {
    ...actual,
    resolveEntityReviewTarget: (...args: unknown[]) => mockResolveEntityReviewTarget(...args),
  }
})

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function HookHarness({ initialEntityId = 'skill-1' }: { initialEntityId?: string | null }) {
  const [entityId, setEntityId] = useState<string | null>(initialEntityId)
  const [unrelatedState, setUnrelatedState] = useState('initial')

  const { descriptor, isResolving, error } = useResolvedReviewTarget({
    workspaceId: 'ws-1',
    entityKind: 'skill',
    entityId,
  })

  return (
    <>
      <div
        data-testid='state'
        data-review-session-id={descriptor?.reviewSessionId ?? ''}
        data-entity-id={descriptor?.entityId ?? ''}
        data-is-resolving={isResolving ? 'true' : 'false'}
        data-error={error ?? ''}
      />
      <button
        data-testid='touch-unrelated-state'
        onClick={() => setUnrelatedState((current) => `${current}-next`)}
      >
        {unrelatedState}
      </button>
      <button data-testid='switch-entity' onClick={() => setEntityId('skill-2')}>
        switch
      </button>
    </>
  )
}

describe('useResolvedReviewTarget', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockResolveEntityReviewTarget.mockReset()
    mockResolveEntityReviewTarget.mockResolvedValue({
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-1',
        draftSessionId: null,
        reviewSessionId: 'review-1',
        yjsSessionId: 'review-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('does not re-resolve after unrelated state changes without a target change', async () => {
    await act(async () => {
      root.render(<HookHarness />)
      await flushPromises()
      await flushPromises()
      await flushPromises()
    })

    const stateNode = container.querySelector('[data-testid="state"]')
    const touchButton = container.querySelector(
      '[data-testid="touch-unrelated-state"]'
    ) as HTMLButtonElement | null
    const initialCallCount = mockResolveEntityReviewTarget.mock.calls.length

    await act(async () => {
      touchButton?.click()
      await flushPromises()
      await flushPromises()
    })

    expect(initialCallCount).toBeGreaterThan(0)
    expect(mockResolveEntityReviewTarget).toHaveBeenCalledTimes(initialCallCount)
    expect(stateNode?.getAttribute('data-review-session-id')).toBe('review-1')
    expect(stateNode?.getAttribute('data-is-resolving')).toBe('false')
    expect(stateNode?.getAttribute('data-error')).toBe('')
  })

  it('resolves the requested entity id', async () => {
    mockResolveEntityReviewTarget.mockResolvedValueOnce({
      descriptor: {
        workspaceId: 'ws-1',
        entityKind: 'skill',
        entityId: 'skill-2',
        draftSessionId: null,
        reviewSessionId: 'review-2',
        yjsSessionId: 'review-2',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })

    await act(async () => {
      root.render(<HookHarness initialEntityId='skill-2' />)
      await flushPromises()
      await flushPromises()
      await flushPromises()
    })

    expect(mockResolveEntityReviewTarget).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      entityKind: 'skill',
      entityId: 'skill-2',
    })
    expect(container.querySelector('[data-testid="state"]')).toHaveAttribute(
      'data-entity-id',
      'skill-2'
    )
    expect(container.querySelector('[data-testid="state"]')).toHaveAttribute(
      'data-review-session-id',
      'review-2'
    )
  })
})
