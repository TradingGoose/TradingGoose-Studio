import { describe, expect, it } from 'vitest'
import { buildSubBlockRows } from './sub-block-layout'

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
})
