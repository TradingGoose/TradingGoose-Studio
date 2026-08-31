import { describe, expect, it } from 'vitest'
import { buildTriggerSubBlocks } from '@/triggers'

describe('buildTriggerSubBlocks', () => {
  it('keeps generated shell fields owned by sibling trigger definitions', () => {
    const triggerId = 'provider_sibling_event'
    const subBlocks = buildTriggerSubBlocks({
      triggerId,
      triggerOptions: [],
      includeDropdown: false,
      includeWebhookUrl: true,
    })

    expect(subBlocks.some((subBlock) => subBlock.id === 'selectedTriggerId')).toBe(false)

    for (const subBlockId of ['webhookUrlDisplay', 'triggerSave', 'triggerInstructions']) {
      expect(subBlocks.find((subBlock) => subBlock.id === subBlockId)?.condition).toEqual({
        field: 'selectedTriggerId',
        value: triggerId,
      })
    }
  })
})
