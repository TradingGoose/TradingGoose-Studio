import { describe, expect, it, vi } from 'vitest'
import { listWorkflowRunTriggers, resolveWorkflowRunTrigger } from './triggers'

vi.mock('@/blocks', () => {
  const trigger = (id: string) => ({
    category: 'triggers',
    subBlocks: [],
    triggers: { available: [id] },
    outputs: {},
  })
  const registry: Record<string, any> = {
    api_trigger: trigger('api'),
    chat_trigger: trigger('chat'),
    indicator_trigger: {
      ...trigger('indicator_trigger'),
      outputs: { listing: { type: 'listingIdentity' }, signal: { type: 'string' } },
    },
    manual_trigger: trigger('manual'),
    schedule: trigger('schedule'),
    slack: { category: 'blocks', triggers: { available: ['slack_webhook', 'github_webhook'] } },
  }
  return { getBlock: (type: string) => registry[type] }
})

const block = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  subBlocks: {},
  ...extra,
})

describe('resolveWorkflowRunTrigger', () => {
  it('requires an explicit editor trigger when multiple triggers are runnable', () => {
    const mixedTriggers = {
      manual: block('manual_trigger'),
      schedule: block('schedule'),
      shared: block('agent'),
    }
    const mixedTriggerEdges = [
      { source: 'manual', target: 'shared' },
      { source: 'schedule', target: 'shared' },
    ]

    expect(
      resolveWorkflowRunTrigger(mixedTriggers, mixedTriggerEdges, {
        surface: 'editor',
        triggerBlockId: 'schedule',
      }).blockId
    ).toBe('schedule')

    expect(
      listWorkflowRunTriggers(mixedTriggers, mixedTriggerEdges, { surface: 'editor' })
    ).toEqual([
      { blockId: 'manual', name: 'manual_trigger', triggerSource: 'manual', triggerType: 'manual' },
      { blockId: 'schedule', name: 'schedule', triggerSource: 'schedule', triggerType: 'schedule' },
    ])

    expect(() =>
      resolveWorkflowRunTrigger(mixedTriggers, [{ source: 'manual', target: 'shared' }], {
        surface: 'editor',
        triggerBlockId: 'schedule',
      })
    ).toThrow('Trigger block schedule is not available for Run')
  })

  it('resolves runnable trigger identity and editor payloads', () => {
    expect(() =>
      resolveWorkflowRunTrigger(
        { slack: block('slack', { triggerMode: true }), agent: block('agent') },
        [{ source: 'slack', target: 'agent' }],
        { surface: 'editor', triggerBlockId: 'slack' }
      )
    ).toThrow('slack requires a selected trigger type')

    expect(
      resolveWorkflowRunTrigger(
        { indicator: block('indicator_trigger'), agent: block('agent') },
        [{ source: 'indicator', target: 'agent' }],
        { surface: 'editor', triggerBlockId: 'indicator' }
      ).input
    ).toEqual({
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
      signal: 'mock_signal',
    })

    const copilotRun = resolveWorkflowRunTrigger(
      { trigger: block('indicator_trigger'), agent: block('agent') },
      [{ source: 'trigger', target: 'agent' }],
      { surface: 'copilot', triggerBlockId: 'trigger' }
    )
    expect(copilotRun.triggerType).toBe('manual')
    expect(copilotRun.input).toEqual({
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
      signal: 'mock_signal',
    })

    const explicitInput = { listing: { listing_id: 'MSFT' }, signal: 'buy' }
    expect(
      resolveWorkflowRunTrigger(
        { trigger: block('indicator_trigger'), agent: block('agent') },
        [{ source: 'trigger', target: 'agent' }],
        { surface: 'copilot', triggerBlockId: 'trigger', workflowInput: explicitInput }
      ).input
    ).toBe(explicitInput)
  })
})
