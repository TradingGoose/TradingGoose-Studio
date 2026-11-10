import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { hasUiActiveToolCalls } from './store-state'

describe('transient Copilot activity', () => {
  it.each([
    ClientToolCallState.pending,
    ClientToolCallState.review,
    ClientToolCallState.executing,
    ClientToolCallState.background,
  ])('shows %s as active only for live cards', (state) => {
    const call = { id: 'call', name: 'read_workflow', state }
    expect(hasUiActiveToolCalls({ call })).toBe(true)
    expect(hasUiActiveToolCalls({ call: { ...call, historical: true } })).toBe(false)
  })
  it('does not derive native completion from local tool state', () => {
    expect(
      hasUiActiveToolCalls({
        call: { id: 'call', name: 'read_workflow', state: ClientToolCallState.success },
      })
    ).toBe(false)
  })
})
