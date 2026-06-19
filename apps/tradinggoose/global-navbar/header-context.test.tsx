/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  GlobalNavbarHeader,
  GlobalNavbarHeaderProvider,
  useGlobalNavbarHeaderActiveSlots,
  useGlobalNavbarHeaderSlotTarget,
} from './header-context'

function HeaderTarget() {
  const activeSlots = useGlobalNavbarHeaderActiveSlots()
  const leftTarget = useGlobalNavbarHeaderSlotTarget('left')

  return activeSlots.left ? <span ref={leftTarget} /> : <span>default</span>
}

function Harness({ showA, showB }: { showA: boolean; showB: boolean }) {
  return (
    <GlobalNavbarHeaderProvider>
      <HeaderTarget />
      {showA ? <GlobalNavbarHeader left={<span>Header A</span>} /> : null}
      {showB ? <GlobalNavbarHeader left={<span>Header B</span>} /> : null}
    </GlobalNavbarHeaderProvider>
  )
}

describe('GlobalNavbarHeaderProvider', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('keeps the active header owner stable when overlapping contributors unmount', async () => {
    await act(async () => {
      root.render(<Harness showA showB={false} />)
    })

    expect(container.textContent).toContain('Header A')

    await act(async () => {
      root.render(<Harness showA showB />)
    })

    expect(container.textContent).toContain('Header B')
    expect(container.textContent).not.toContain('Header A')

    await act(async () => {
      root.render(<Harness showA={false} showB />)
    })

    expect(container.textContent).toContain('Header B')
    expect(container.textContent).not.toContain('default')

    await act(async () => {
      root.render(<Harness showA showB />)
    })

    expect(container.textContent).toContain('Header A')

    await act(async () => {
      root.render(<Harness showA showB={false} />)
    })

    expect(container.textContent).toContain('Header A')
    expect(container.textContent).not.toContain('default')
  })
})
