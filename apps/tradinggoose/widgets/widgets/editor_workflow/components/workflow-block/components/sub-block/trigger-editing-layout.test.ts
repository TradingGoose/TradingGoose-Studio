import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import {
  buildTriggerEditingLayout,
  removeTriggerModeSelectorFromRows,
} from './trigger-editing-layout'

describe('trigger-editing-layout', () => {
  const blockConfig: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'> = {
    category: 'triggers',
    triggers: {
      enabled: true,
      available: ['github_issue_opened', 'github_issue_closed'],
    },
    subBlocks: [
      {
        id: 'selectedTriggerId',
        title: 'Trigger Type',
        type: 'dropdown',
        mode: 'trigger',
      },
      {
        id: 'openedRepository',
        title: 'Opened Repository',
        type: 'short-input',
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: 'github_issue_opened',
        },
      },
      {
        id: 'closedReason',
        title: 'Closed Reason',
        type: 'short-input',
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: 'github_issue_closed',
        },
      },
    ],
  }

  it('keeps trigger mode editable in workflow layouts', () => {
    const layout = buildTriggerEditingLayout({
      blockConfig,
      blockState: {
        triggerMode: true,
        subBlocks: {
          selectedTriggerId: { value: 'github_issue_closed' },
        },
      },
      shouldDisableWrite: false,
    })

    expect(layout.regularRows.flat().map((subBlock) => subBlock.id)).toEqual([
      'selectedTriggerId',
      'closedReason',
    ])
  })

  it('removes the trigger mode selector from deploy rows while keeping the active mode fields', () => {
    const layout = buildTriggerEditingLayout({
      blockConfig,
      blockState: {
        triggerMode: true,
        subBlocks: {
          selectedTriggerId: { value: 'github_issue_closed' },
        },
      },
      shouldDisableWrite: false,
    })

    expect(removeTriggerModeSelectorFromRows(layout.regularRows).flat().map((subBlock) => subBlock.id)).toEqual([
      'closedReason',
    ])
  })
})
