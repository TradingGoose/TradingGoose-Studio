/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewTargetDescriptor, ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'
import { EntitySessionHost, useEntitySession } from './entity-session-host'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockBootstrapYjsProvider = vi.fn()
const mockRegisterEntitySession = vi.fn()
const mockUnregisterEntitySession = vi.fn()
const mockUpdateRegisteredEntitySession = vi.fn()

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: any[]) => mockBootstrapYjsProvider(...args),
}))

vi.mock('@/lib/yjs/entity-session-registry', () => ({
  registerEntitySession: (...args: any[]) => mockRegisterEntitySession(...args),
  unregisterEntitySession: (...args: any[]) => mockUnregisterEntitySession(...args),
  updateRegisteredEntitySession: (...args: any[]) => mockUpdateRegisteredEntitySession(...args),
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

function createDescriptor(reviewSessionId: string, entityId: string): ReviewTargetDescriptor {
  return {
    workspaceId: 'ws-1',
    entityKind: 'skill',
    entityId,
    draftSessionId: null,
    reviewSessionId,
    yjsSessionId: reviewSessionId,
  }
}

function createBootstrapResult(descriptor: ReviewTargetDescriptor, name: string) {
  const doc = new Y.Doc()
  doc.getMap('fields').set('name', name)

  const awareness = {
    setLocalState: vi.fn(),
  }
  const provider = {
    awareness,
    on: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  }
  const runtime: ReviewTargetRuntimeState = {
    docState: 'active',
    replaySafe: true,
    reseededFromCanonical: false,
  }

  return {
    doc,
    provider: provider as any,
    descriptor,
    runtime,
  }
}

function SessionProbe() {
  const session = useEntitySession()
  const name = session.doc ? String(session.doc.getMap('fields').get('name') ?? '') : ''

  return (
    <div
      data-testid='probe'
      data-loading={String(session.isLoading)}
      data-session-id={session.descriptor?.reviewSessionId ?? ''}
      data-name={name}
      data-error={session.error ?? ''}
    />
  )
}

describe('EntitySessionHost', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockBootstrapYjsProvider.mockReset()
    mockRegisterEntitySession.mockReset()
    mockUnregisterEntitySession.mockReset()
    mockUpdateRegisteredEntitySession.mockReset()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('masks the previous doc immediately when the review session changes', async () => {
    const descriptorA = createDescriptor('review-a', 'skill-a')
    const descriptorB = createDescriptor('review-b', 'skill-b')
    const resultA = createBootstrapResult(descriptorA, 'Skill A')
    const resultB = createBootstrapResult(descriptorB, 'Skill B')
    const deferredB = createDeferred<typeof resultB>()

    mockBootstrapYjsProvider
      .mockResolvedValueOnce(resultA)
      .mockImplementationOnce(() => deferredB.promise)

    await act(async () => {
      root.render(
        <EntitySessionHost descriptor={descriptorA}>
          <SessionProbe />
        </EntitySessionHost>
      )
      await Promise.resolve()
    })

    let probe = container.querySelector('[data-testid="probe"]')
    expect(probe?.getAttribute('data-loading')).toBe('false')
    expect(probe?.getAttribute('data-session-id')).toBe('review-a')
    expect(probe?.getAttribute('data-name')).toBe('Skill A')

    await act(async () => {
      root.render(
        <EntitySessionHost descriptor={descriptorB}>
          <SessionProbe />
        </EntitySessionHost>
      )
    })

    probe = container.querySelector('[data-testid="probe"]')
    expect(probe?.getAttribute('data-loading')).toBe('true')
    expect(probe?.getAttribute('data-session-id')).toBe('review-b')
    expect(probe?.getAttribute('data-name')).toBe('')

    await act(async () => {
      deferredB.resolve(resultB)
      await deferredB.promise
      await Promise.resolve()
    })

    probe = container.querySelector('[data-testid="probe"]')
    expect(probe?.getAttribute('data-loading')).toBe('false')
    expect(probe?.getAttribute('data-session-id')).toBe('review-b')
    expect(probe?.getAttribute('data-name')).toBe('Skill B')
  })

  it('publishes awareness when the user becomes available after bootstrap', async () => {
    const descriptor = createDescriptor('review-a', 'skill-a')
    const result = createBootstrapResult(descriptor, 'Skill A')

    mockBootstrapYjsProvider.mockResolvedValueOnce(result)

    await act(async () => {
      root.render(
        <EntitySessionHost descriptor={descriptor}>
          <SessionProbe />
        </EntitySessionHost>
      )
      await Promise.resolve()
    })

    expect(result.provider.awareness.setLocalState).toHaveBeenCalledWith(null)

    await act(async () => {
      root.render(
        <EntitySessionHost
          descriptor={descriptor}
          user={{
            id: 'user-1',
            name: 'User',
            email: 'user@example.com',
          }}
        >
          <SessionProbe />
        </EntitySessionHost>
      )
    })

    expect(result.provider.awareness.setLocalState).toHaveBeenLastCalledWith({
      user: {
        id: 'user-1',
        name: 'User',
        email: 'user@example.com',
        color: expect.any(String),
      },
    })
  })
})
