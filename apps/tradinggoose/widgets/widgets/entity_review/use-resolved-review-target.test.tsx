/**
 * @vitest-environment jsdom
 */

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import { readEntitySelectionState } from '@/widgets/widgets/entity_review/review-target-utils'
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

function HookHarness({
  initialPairContext,
  initialParams = null,
}: {
  initialPairContext?: PairColorContext | null
  initialParams?: Record<string, unknown> | null
}) {
  const [pairContext, setPairContext] = useState<PairColorContext | null>(
    initialPairContext ?? {
      skillId: 'skill-1',
    }
  )

  const selectionState = readEntitySelectionState({
    pairContext,
    params: initialParams,
    entityIdKey: 'skillId',
  })

  const { descriptor, isResolving, error } = useResolvedReviewTarget({
    workspaceId: 'ws-1',
    entityKind: 'skill',
    pairColor: 'red',
    entityIdKey: 'skillId',
    selectionState,
    setPairContext: (_color, context) => {
      setPairContext({
        ...context,
        workflowId: 'workflow-current',
      })
    },
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
        data-testid='touch-pair-context'
        onClick={() =>
          setPairContext((current) =>
            current
              ? {
                  ...current,
                  workflowId:
                    current.workflowId === 'workflow-current'
                      ? 'workflow-next'
                      : 'workflow-current',
                }
              : {
                  skillId: 'skill-1',
                  workflowId: 'workflow-current',
                }
          )
        }
      >
        touch
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

  it('does not re-resolve after pair context changes without a target change', async () => {
    await act(async () => {
      root.render(<HookHarness />)
      await flushPromises()
      await flushPromises()
      await flushPromises()
    })

    const stateNode = container.querySelector('[data-testid="state"]')
    const touchButton = container.querySelector(
      '[data-testid="touch-pair-context"]'
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

  it('resolves the current linked entity id', async () => {
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
      root.render(
        <HookHarness
          initialPairContext={{
            skillId: 'skill-2',
          }}
        />
      )
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
