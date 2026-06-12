import { describe, expect, it, vi } from 'vitest'
import { resolveEditorTestTrigger } from '@/lib/workflows/triggers'
import { resolveTriggerIdForBlock, resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) =>
    (
      ({
        schedule: {
          category: 'triggers',
          triggers: { available: ['schedule'] },
        },
        slack: {
          category: 'tools',
          triggers: { available: ['slack_webhook'] },
        },
        hubspot: {
          category: 'tools',
          name: 'HubSpot',
          triggers: { available: ['hubspot_contact_created', 'hubspot_contact_deleted'] },
        },
      }) as Record<string, any>
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
    const triggerId = resolveTriggerIdFromSubBlocks({}, [
      'calendly_routing_form_submitted',
      'calendly_webhook',
    ])

    expect(triggerId).toBeNull()
    expect(() =>
      resolveEditorTestTrigger(
        {
          hubspot: { type: 'hubspot', name: 'HubSpot', triggerMode: true, subBlocks: {} },
        },
        [{ source: 'hubspot' }]
      )
    ).toThrow('HubSpot requires a selected trigger type')
  })

  it('resolves singleton trigger blocks without persisted selection', () => {
    expect(resolveTriggerIdForBlock({ type: 'schedule', subBlocks: {} })).toBe('schedule')
    expect(resolveTriggerIdForBlock({ type: 'slack', triggerMode: true, subBlocks: {} })).toBe(
      'slack_webhook'
    )
    expect(resolveTriggerIdForBlock({ type: 'slack', subBlocks: {} })).toBeNull()
    expect(
      resolveEditorTestTrigger(
        { schedule: { type: 'schedule', name: 'Schedule', subBlocks: {} } },
        [{ source: 'schedule' }]
      )
    ).toMatchObject({ blockId: 'schedule', input: {} })
    expect(() =>
      resolveEditorTestTrigger(
        { schedule: { type: 'schedule', name: 'Schedule', subBlocks: {} } },
        []
      )
    ).toThrow('Schedule must be connected to other blocks to execute')
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
