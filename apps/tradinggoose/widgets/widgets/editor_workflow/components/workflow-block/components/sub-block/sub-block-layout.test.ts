import { describe, expect, it } from 'vitest'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'

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
})
