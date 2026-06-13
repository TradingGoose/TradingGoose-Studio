import { describe, expect, it, vi } from 'vitest'
import { resolveWorkflowRunTrigger } from './triggers'

vi.mock('@/blocks', () => {
  const trigger = (id: string) => ({
    category: 'triggers',
    subBlocks: [],
    triggers: { available: [id] },
    outputs: {},
  })
  const registry = {
    agent: { category: 'blocks', subBlocks: [], outputs: {} },
    chat_trigger: trigger('chat'),
    manual_trigger: trigger('manual'),
    schedule: trigger('schedule'),
  }

  return {
    getBlock: (type: string) => registry[type as keyof typeof registry],
  }
})

const block = (type: string, name = type) => ({
  type,
  name,
  subBlocks: {},
})

describe('resolveWorkflowRunTrigger', () => {
  it('selects the non-chat trigger when the selected block has mixed chat and non-chat ancestry', () => {
    const result = resolveWorkflowRunTrigger(
      {
        chat: block('chat_trigger', 'Chat'),
        schedule: block('schedule', 'Schedule'),
        shared: block('agent', 'Shared Agent'),
      },
      [
        { source: 'chat', target: 'shared' },
        { source: 'schedule', target: 'shared' },
      ],
      { surface: 'editor', selectedBlockId: 'shared' }
    )

    expect(result.blockId).toBe('schedule')
  })

  it('requires a trigger selection when the selected block has multiple non-chat ancestors', () => {
    expect(() =>
      resolveWorkflowRunTrigger(
        {
          manual: block('manual_trigger', 'Manual'),
          schedule: block('schedule', 'Schedule'),
          shared: block('agent', 'Shared Agent'),
        },
        [
          { source: 'manual', target: 'shared' },
          { source: 'schedule', target: 'shared' },
        ],
        { surface: 'editor', selectedBlockId: 'shared' }
      )
    ).toThrow(
      'Multiple trigger blocks found. Select one trigger block or a block on one trigger branch for Run.'
    )
  })
})
