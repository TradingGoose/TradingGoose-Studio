/** @vitest-environment jsdom */

import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useYjsSubscription } from './use-yjs-subscription'

interface TestSource<T> {
  subscribe: (cb: () => void) => () => void
  extract: () => T
  fallback: T
}

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

function Harness<T>({ source, capture }: { source: TestSource<T>; capture: (value: T) => void }) {
  const value = useYjsSubscription(source.subscribe, source.extract, source.fallback)
  capture(value)
  return null
}

describe('useYjsSubscription', () => {
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    root = null
    container?.remove()
    container = null
  })

  afterAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('re-extracts when the subscription source changes before any store event fires', async () => {
    const emptyBlocks: Record<string, any> = {}
    const liveBlocks = {
      existing: {
        id: 'existing',
        type: 'generic_webhook',
      },
    }

    const emptySource: TestSource<Record<string, any>> = {
      subscribe: () => () => {},
      extract: () => emptyBlocks,
      fallback: emptyBlocks,
    }

    const liveSource: TestSource<Record<string, any>> = {
      subscribe: () => () => {},
      extract: () => liveBlocks,
      fallback: emptyBlocks,
    }

    let latestValue: Record<string, any> = emptyBlocks

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<Harness source={emptySource} capture={(value) => { latestValue = value }} />)
    })

    expect(latestValue).toBe(emptyBlocks)

    await act(async () => {
      root?.render(<Harness source={liveSource} capture={(value) => { latestValue = value }} />)
    })

    expect(latestValue).toBe(liveBlocks)
    expect(Object.keys(latestValue)).toContain('existing')
  })
})
