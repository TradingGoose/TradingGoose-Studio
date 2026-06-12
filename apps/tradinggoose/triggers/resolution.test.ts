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
        indicator_trigger: {
          category: 'triggers',
          name: 'Indicator Monitor',
          triggers: { enabled: true, available: ['indicator_trigger'] },
        },
        portfolio_state_trigger: {
          category: 'triggers',
          name: 'Portfolio Monitor',
          triggers: { enabled: true, available: ['portfolio_state_trigger'] },
        },
      }) as Record<string, any>
    )[type],
}))

const triggerBlock = (type: string, name: string) => ({ type, name, subBlocks: {} })

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
      resolveEditorTestTrigger({ schedule: triggerBlock('schedule', 'Schedule') }, [
        { source: 'schedule' },
      ])
    ).toMatchObject({ blockId: 'schedule', input: {} })
    expect(
      resolveEditorTestTrigger(
        { indicator: triggerBlock('indicator_trigger', 'Indicator Monitor') },
        [{ source: 'indicator' }]
      )
    ).toMatchObject({ blockId: 'indicator', input: { event: 'mock_event', time: 42 } })
    expect(
      resolveEditorTestTrigger(
        { portfolio: triggerBlock('portfolio_state_trigger', 'Portfolio Monitor') },
        [{ source: 'portfolio' }]
      )
    ).toMatchObject({ blockId: 'portfolio', input: { event: 'mock_event' } })
    expect(
      resolveEditorTestTrigger(
        {
          schedule: triggerBlock('schedule', 'Schedule'),
          indicator: triggerBlock('indicator_trigger', 'Indicator Monitor'),
        },
        [{ source: 'schedule' }]
      )
    ).toMatchObject({ blockId: 'schedule' })
    expect(() =>
      resolveEditorTestTrigger(
        {
          first: triggerBlock('schedule', 'First Schedule'),
          second: triggerBlock('indicator_trigger', 'Indicator Monitor'),
        },
        [{ source: 'first' }, { source: 'second' }]
      )
    ).toThrow('Multiple runnable trigger blocks found. Keep one trigger connected for Run.')
    expect(() =>
      resolveEditorTestTrigger({ schedule: triggerBlock('schedule', 'Schedule') }, [])
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
