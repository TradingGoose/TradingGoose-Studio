import { describe, expect, it } from 'vitest'
import {
  persistSingletonTriggerSelection,
  resolveTriggerIdFromSubBlocks,
} from '@/triggers/resolution'

describe('trigger resolution', () => {
  it('uses selectedTriggerId as the canonical trigger selection', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        selectedTriggerId: { value: 'calendly_routing_form_submitted' },
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_routing_form_submitted', 'calendly_webhook']
    )

    expect(triggerId).toBe('calendly_routing_form_submitted')
  })

  it('does not default to the available trigger id when there is no explicit selection', () => {
    const triggerId = resolveTriggerIdFromSubBlocks({}, ['api'])

    expect(triggerId).toBeNull()
  })

  it('does not use triggerId as a trigger selection alias', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_webhook']
    )

    expect(triggerId).toBeNull()
  })

  it('rejects registered trigger ids that are not available to the block', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        selectedTriggerId: { value: 'github_webhook' },
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_invitee_created']
    )

    expect(triggerId).toBeNull()
  })

  it('persists singleton trigger selections only when trigger mode is active', () => {
    const blockConfig = {
      category: 'tools',
      triggers: { enabled: true, available: ['api'] },
      subBlocks: [{ id: 'selectedTriggerId', type: 'dropdown' }],
    } as Parameters<typeof persistSingletonTriggerSelection>[1]

    expect(persistSingletonTriggerSelection({}, blockConfig, false)).toEqual({})
    expect(persistSingletonTriggerSelection({}, blockConfig, true)).toEqual({
      selectedTriggerId: {
        id: 'selectedTriggerId',
        type: 'dropdown',
        value: 'api',
      },
    })
  })
})
