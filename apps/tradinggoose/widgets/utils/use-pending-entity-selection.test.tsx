/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingEntitySelection } from './use-pending-entity-selection'

const onSelect = vi.fn()
const selectRef: { current: ((entityId: string) => void) | null } = { current: null }
let root: ReturnType<typeof createRoot> | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

function Harness({ members }: { members: Array<{ entityId: string }> }) {
  selectRef.current = usePendingEntitySelection(members, onSelect)
  return null
}

const render = (members: Array<{ entityId: string }>) =>
  act(async () => {
    root!.render(<Harness members={members} />)
  })
const select = (entityId: string) =>
  act(async () => {
    selectRef.current!(entityId)
  })

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  onSelect.mockReset()
  root = createRoot(document.body.appendChild(document.createElement('div')))
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

describe('usePendingEntitySelection', () => {
  it('fires listed ids immediately, defers unlisted ids, and lets the latest request win', async () => {
    await render([{ entityId: 'a' }])
    await select('a')
    expect(onSelect).toHaveBeenLastCalledWith('a')

    await select('b')
    expect(onSelect).toHaveBeenCalledTimes(1)
    await render([{ entityId: 'a' }, { entityId: 'b' }])
    expect(onSelect).toHaveBeenLastCalledWith('b')

    await select('c')
    await select('a')
    expect(onSelect).toHaveBeenLastCalledWith('a')
    await render([{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }])
    expect(onSelect).toHaveBeenCalledTimes(3)

    await select('never-appears')
    await render([{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }])
    expect(onSelect).toHaveBeenCalledTimes(3)
  })
})
