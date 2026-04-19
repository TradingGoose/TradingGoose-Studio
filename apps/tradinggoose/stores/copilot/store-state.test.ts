import { describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import {
  ACTIVE_TURN_STATUS,
  COMPLETED_TURN_STATUS,
  hasUiActiveToolCalls,
  resolveTurnStatusFromToolCalls,
} from '@/stores/copilot/store-state'

describe('copilot store state helpers', () => {
  it('treats review tools as active for widget UI state', () => {
    expect(
      hasUiActiveToolCalls({
        'review-tool': {
          id: 'review-tool',
          name: 'edit_workflow',
          state: ClientToolCallState.review,
        },
      } as any)
    ).toBe(true)
  })

  it('keeps persisted turn status completed for review-only tools', () => {
    expect(
      resolveTurnStatusFromToolCalls({
        'review-tool': {
          id: 'review-tool',
          name: 'edit_workflow',
          state: ClientToolCallState.review,
        },
      } as any)
    ).toBe(COMPLETED_TURN_STATUS)
  })

  it('keeps persisted turn status in progress for runtime-active tools', () => {
    expect(
      resolveTurnStatusFromToolCalls({
        'pending-tool': {
          id: 'pending-tool',
          name: 'run_workflow',
          state: ClientToolCallState.pending,
        },
      } as any)
    ).toBe(ACTIVE_TURN_STATUS)
  })
})
