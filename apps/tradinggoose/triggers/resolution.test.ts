import { describe, expect, it } from 'vitest'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

describe('trigger resolution', () => {
  it('prefers selectedTriggerId over saved triggerId', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        selectedTriggerId: { value: 'calendly_routing_form_submitted' },
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_invitee_created', 'calendly_webhook']
    )

    expect(triggerId).toBe('calendly_routing_form_submitted')
  })

  it('falls back to the available trigger id when there is no explicit selection', () => {
    const triggerId = resolveTriggerIdFromSubBlocks({}, ['api'])

    expect(triggerId).toBe('api')
  })

  it('uses the saved trigger id when there is no current trigger selection', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_invitee_created']
    )

    expect(triggerId).toBe('calendly_webhook')
  })
})
