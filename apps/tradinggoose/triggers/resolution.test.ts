import { describe, expect, it, vi } from 'vitest'
import { resolveTriggerIdForBlock, resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) =>
    (
      {
        schedule: {
          category: 'triggers',
          triggers: { available: ['schedule'] },
        },
        slack: {
          category: 'tools',
          triggers: { available: ['slack_webhook'] },
        },
      } as Record<string, any>
    )[type],
}))

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

  it('derives singleton trigger identity from block config', () => {
    const triggerId = resolveTriggerIdFromSubBlocks({}, ['api'])

    expect(triggerId).toBe('api')
  })

  it('requires explicit selection for multi-trigger blocks', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {},
      ['calendly_routing_form_submitted', 'calendly_webhook']
    )

    expect(triggerId).toBeNull()
  })

  it('resolves singleton trigger blocks without persisted selection', () => {
    expect(resolveTriggerIdForBlock({ type: 'schedule', subBlocks: {} })).toBe('schedule')
    expect(resolveTriggerIdForBlock({ type: 'slack', triggerMode: true, subBlocks: {} })).toBe(
      'slack_webhook'
    )
    expect(resolveTriggerIdForBlock({ type: 'slack', subBlocks: {} })).toBeNull()
  })

  it('does not use triggerId as a trigger selection alias', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_routing_form_submitted', 'calendly_webhook']
    )

    expect(triggerId).toBeNull()
  })

  it('rejects registered trigger ids that are not available to the block', () => {
    const triggerId = resolveTriggerIdFromSubBlocks(
      {
        selectedTriggerId: { value: 'github_webhook' },
        triggerId: { value: 'calendly_webhook' },
      },
      ['calendly_invitee_created', 'calendly_webhook']
    )

    expect(triggerId).toBeNull()
  })
})
