import { describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getAllBlocks } from '@/blocks'
import type { BlockConfig } from '@/blocks/types'

const multiTriggerBlocks = getAllBlocks().filter(
  (blockConfig) => (blockConfig.triggers?.available?.length ?? 0) > 1
)
const webflowBlock = multiTriggerBlocks.find((blockConfig) => blockConfig.type === 'webflow')!

describe('buildSubBlockRows', () => {
  const triggerSubBlocks = [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_issue_opened',
      },
    },
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'short-input',
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'github_issue_opened',
      },
    },
  ] as const

  const baseArgs = {
    subBlocks: [...triggerSubBlocks],
    stateToUse: {
      selectedTriggerId: { value: 'github_issue_opened' },
      contentType: { value: 'application/json' },
      inputFormat: { value: 'payload' },
    },
    isAdvancedMode: false,
    isTriggerMode: true,
    isPureTriggerBlock: true,
    availableTriggerIds: ['github_issue_opened'],
    hideFromPreview: false,
  }

  function getVisibleIds(triggerSubBlockOwner: 'editor' | 'deploy' | 'all') {
    return buildSubBlockRows({
      ...baseArgs,
      triggerSubBlockOwner,
    })
      .flat()
      .map((subBlock) => subBlock.id)
  }

  function getVisibleTriggerIds(blockConfig: BlockConfig, selectedTriggerId: string) {
    return buildSubBlockRows({
      subBlocks: blockConfig.subBlocks,
      stateToUse: { selectedTriggerId: { value: selectedTriggerId } },
      isAdvancedMode: false,
      isTriggerMode: true,
      isPureTriggerBlock: blockConfig.category === 'triggers',
      availableTriggerIds: blockConfig.triggers?.available,
      hideFromPreview: false,
      triggerSubBlockOwner: 'all',
    })
      .flat()
      .map((subBlock) => subBlock.id)
  }

  it('keeps deploy-managed trigger fields out of editor-owned rows', () => {
    expect(getVisibleIds('editor')).toEqual(['inputFormat'])
  })

  it('returns deploy-managed trigger fields for deploy-owned rows', () => {
    expect(getVisibleIds('deploy')).toEqual(['selectedTriggerId', 'contentType'])
  })

  it('returns both editor-managed and deploy-managed trigger fields for preview rows', () => {
    expect(getVisibleIds('all')).toEqual(['selectedTriggerId', 'contentType', 'inputFormat'])
  })

  it('does not show trigger-specific fields for unavailable persisted trigger ids', () => {
    const rows = buildSubBlockRows({
      ...baseArgs,
      availableTriggerIds: ['github_issue_opened', 'github_issue_closed'],
      stateToUse: {
        selectedTriggerId: { value: 'github_webhook' },
        contentType: { value: 'application/json' },
        inputFormat: { value: 'payload' },
      },
      triggerSubBlockOwner: 'all',
    })

    expect(rows.flat().map((subBlock) => subBlock.id)).toEqual(['selectedTriggerId'])
  })

  it('derives singleton trigger fields from block config when selection is absent', () => {
    const rows = buildSubBlockRows({
      ...baseArgs,
      stateToUse: {
        contentType: { value: 'application/json' },
        inputFormat: { value: 'payload' },
      },
      triggerSubBlockOwner: 'all',
    })

    expect(rows.flat().map((subBlock) => subBlock.id)).toEqual([
      'selectedTriggerId',
      'contentType',
      'inputFormat',
    ])
  })

  it('evaluates advanced field conditions against basic configured values', () => {
    const rows = buildSubBlockRows({
      subBlocks: [
        {
          id: 'operation',
          title: 'Operation',
          type: 'dropdown',
          mode: 'basic',
        },
        {
          id: 'files',
          title: 'Files',
          type: 'file-selector',
          mode: 'advanced',
          condition: { field: 'operation', value: 'send' },
        },
      ],
      stateToUse: {
        operation: { value: 'send' },
      },
      isAdvancedMode: true,
      isTriggerMode: false,
      isPureTriggerBlock: false,
    })

    expect(rows.flat().map((subBlock) => subBlock.id)).toEqual(['files'])
  })

  it('keeps default and trigger rows out of advanced rendering', () => {
    const rows = buildSubBlockRows({
      subBlocks: [
        { id: 'message', title: 'Message', type: 'long-input' },
        { id: 'selectedTriggerId', title: 'Trigger Type', type: 'dropdown', mode: 'trigger' },
        { id: 'files', title: 'Files', type: 'file-selector', mode: 'advanced' },
      ],
      stateToUse: {
        message: { value: 'hello' },
        selectedTriggerId: { value: 'slack_message' },
        files: { value: ['file-1'] },
      },
      isAdvancedMode: true,
      isTriggerMode: false,
      isPureTriggerBlock: false,
      triggerSubBlockOwner: 'all',
    })

    expect(rows.flat().map((subBlock) => subBlock.id)).toEqual(['files'])
  })

  it.each(multiTriggerBlocks)(
    'renders one field instance per selected $type trigger',
    (blockConfig) => {
      for (const triggerId of blockConfig.triggers?.available ?? []) {
        const visibleIds = getVisibleTriggerIds(blockConfig, triggerId)

        expect(visibleIds, `${blockConfig.type}:${triggerId}`).toEqual([...new Set(visibleIds)])
      }
    }
  )

  it.each(multiTriggerBlocks)(
    'lists every available $type trigger in its selector',
    (blockConfig) => {
      const selector = blockConfig.subBlocks.find(
        (subBlock) => subBlock.id === 'selectedTriggerId' && !subBlock.hidden
      )
      const options =
        typeof selector?.options === 'function' ? selector.options() : (selector?.options ?? [])

      expect(new Set(options.map((option) => option.id))).toEqual(
        new Set(blockConfig.triggers?.available)
      )
    }
  )

  it('keeps Webflow fields scoped to the selected trigger variant', () => {
    const collectionFields = getVisibleTriggerIds(webflowBlock, 'webflow_collection_item_created')
    const formFields = getVisibleTriggerIds(webflowBlock, 'webflow_form_submission')

    expect(collectionFields).toContain('collectionId')
    expect(collectionFields).not.toContain('formId')
    expect(formFields).toContain('formId')
    expect(formFields).not.toContain('collectionId')
  })
})
