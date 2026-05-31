import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import { getWorkflowInspectorCopy } from '@/i18n/workflow-inspector'
import { localizeWorkflowSubBlockConfigWithCopy } from '@/i18n/workflow-inspector-core'
import {
  buildTriggerEditingLayout,
  removeTriggerModeSelectorFromRows,
} from './trigger-editing-layout'

describe('trigger-editing-layout', () => {
  const regularBlockConfig: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'> = {
    category: 'blocks',
    subBlocks: [
      {
        id: 'systemPrompt',
        title: 'System Prompt',
        type: 'long-input',
        placeholder: 'Enter system prompt...',
      },
      {
        id: 'userPrompt',
        title: 'User Prompt',
        type: 'long-input',
        placeholder: 'Enter context or user message...',
      },
      {
        id: 'model',
        title: 'Model',
        type: 'combobox',
        placeholder: 'Type or select a model...',
      },
      {
        id: 'temperature',
        title: 'Temperature',
        type: 'slider',
      },
      {
        id: 'tools',
        title: 'Tools',
        type: 'tool-input',
      },
      {
        id: 'skills',
        title: 'Skills',
        type: 'skill-input',
      },
      {
        id: 'apiKey',
        title: 'API Key',
        type: 'short-input',
        placeholder: 'Enter your API key',
      },
      {
        id: 'responseFormat',
        title: 'Response Format',
        type: 'code',
        placeholder: 'Enter JSON schema...',
      },
    ],
  }

  const triggerBlockConfig: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'> = {
    category: 'blocks',
    subBlocks: [
      {
        id: 'systemPrompt',
        title: 'System Prompt',
        type: 'long-input',
        placeholder: 'Enter system prompt...',
        mode: 'trigger',
      },
      {
        id: 'userPrompt',
        title: 'User Prompt',
        type: 'long-input',
        placeholder: 'Enter context or user message...',
        mode: 'trigger',
      },
      {
        id: 'model',
        title: 'Model',
        type: 'combobox',
        placeholder: 'Type or select a model...',
        mode: 'trigger',
      },
      {
        id: 'apiKey',
        title: 'API Key',
        type: 'short-input',
        placeholder: 'Enter your API key',
        mode: 'trigger',
      },
      {
        id: 'responseFormat',
        title: 'Response Format',
        type: 'code',
        placeholder: 'Enter JSON schema...',
        mode: 'trigger',
      },
    ],
  }

  it.each([
    { locale: 'es' as const },
    { locale: 'zh' as const },
  ])('localizes trigger rows through the shared trigger-edit layout for $locale', ({ locale }) => {
    const inspectorCopy = getWorkflowInspectorCopy(locale)
    const layout = buildTriggerEditingLayout({
      inspectorCopy,
      blockType: 'agent',
      blockConfig: regularBlockConfig,
      blockState: {
        subBlocks: {},
      },
      shouldDisableWrite: false,
    })
    const expectedSubBlocks = regularBlockConfig.subBlocks.map((subBlock) =>
      localizeWorkflowSubBlockConfigWithCopy(inspectorCopy, subBlock, 'agent')
    )

    expect(layout.regularRows.flat().map((subBlock) => subBlock.title)).toEqual(
      expectedSubBlocks.map((subBlock) => subBlock.title)
    )
    expect(layout.regularRows.flat().map((subBlock) => subBlock.placeholder)).toEqual(
      expectedSubBlocks.map((subBlock) => subBlock.placeholder)
    )
  })

  it('removes the trigger mode selector from deploy rows while keeping the active mode fields', () => {
    const layout = buildTriggerEditingLayout({
      inspectorCopy: getWorkflowInspectorCopy('es'),
      blockType: 'agent',
      blockConfig: triggerBlockConfig,
      blockState: {
        triggerMode: true,
        subBlocks: {
          systemPrompt: { value: 'prompt' },
        },
      },
      shouldDisableWrite: false,
    })

    expect(removeTriggerModeSelectorFromRows(layout.regularRows).flat().map((subBlock) => subBlock.id)).toEqual([
      'systemPrompt',
      'userPrompt',
      'model',
      'apiKey',
      'responseFormat',
    ])
  })
})
