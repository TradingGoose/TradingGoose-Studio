import { describe, expect, it, vi } from 'vitest'
import { resolveWorkflowRunTrigger } from './triggers'

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
  it('makes editor selection authoritative', () => {
    expect(
      resolveWorkflowRunTrigger(
        { chat: block('chat_trigger'), schedule: block('schedule'), shared: block('agent') },
        [
          { source: 'chat', target: 'shared' },
          { source: 'schedule', target: 'shared' },
        ],
        { surface: 'editor', selectedBlockId: 'shared' }
      ).blockId
    ).toBe('schedule')

    expect(() =>
      resolveWorkflowRunTrigger(
        { manual: block('manual_trigger'), schedule: block('schedule'), shared: block('agent') },
        [
          { source: 'manual', target: 'shared' },
          { source: 'schedule', target: 'shared' },
        ],
        { surface: 'editor', selectedBlockId: 'shared' }
      )
    ).toThrow('Multiple trigger blocks found')

    expect(() =>
      resolveWorkflowRunTrigger(
        { schedule: block('schedule'), agent: block('agent'), isolated: block('agent') },
        [{ source: 'schedule', target: 'agent' }],
        { surface: 'editor', selectedBlockId: 'isolated' }
      )
    ).toThrow('Selected block is not on a non-chat trigger branch for Run')
  })

  it('resolves runnable trigger identity and editor payloads', () => {
    expect(() =>
      resolveWorkflowRunTrigger(
        { slack: block('slack', { triggerMode: true }), agent: block('agent') },
        [{ source: 'slack', target: 'agent' }],
        { surface: 'editor', selectedBlockId: 'agent' }
      )
    ).toThrow('slack requires a selected trigger type')

    expect(
      resolveWorkflowRunTrigger(
        { indicator: block('indicator_trigger'), agent: block('agent') },
        [{ source: 'indicator', target: 'agent' }],
        { surface: 'editor' }
      ).input
    ).toEqual({
      listing: { listing_id: 'AAPL', base_id: '', quote_id: '', listing_type: 'default' },
      signal: 'mock_signal',
    })

    expect(
      resolveWorkflowRunTrigger(
        { trigger: block('schedule'), agent: block('agent') },
        [{ source: 'trigger', target: 'agent' }],
        { surface: 'copilot' }
      ).triggerType
    ).toBe('schedule')
  })
})
