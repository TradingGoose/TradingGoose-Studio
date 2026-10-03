import { ConditionalIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'

interface ConditionBlockOutput {
  success: boolean
  output: {
    conditionResult: boolean
    selectedPath: {
      blockId: string
      blockType: string
      blockTitle: string
    }
    selectedOption: string
  }
}

export const ConditionBlock: BlockConfig<ConditionBlockOutput> = {
  type: 'condition',
  name: 'Condition',
  description: 'Add a condition',
  longDescription:
    'Evaluate JavaScript expressions in order and follow the first matching connected condition. Else is the fallback when no expression matches. Reference upstream outputs and workflow variables with exact TradingGoose tags. conditionResult reports whether a connected path was selected, including Else; it is not the value of the first expression. Without a matching connected path, conditionResult is false and selectedPath is null. Invalid expressions fail the block. Condition blocks do not support error-path recovery; validate uncertain data in an upstream Function block when recovery is required.',
  bestPractices: `
  - Write the conditions using standard javascript syntax except referencing the outputs of previous blocks using <> syntax, and keep them as simple as possible. No hacky fallbacks.
  - Reference upstream outputs with exact tags like <agent.content> and workflow variables with exact tags like <variable.riskLimit>.
  `,
  docsLink: 'https://docs.tradinggoose.ai/blocks/condition',
  bgColor: '#FF752F',
  icon: ConditionalIcon,
  category: 'blocks',
  subBlocks: [
    {
      id: 'conditions',
      title: 'Conditions',
      description:
        'Ordered condition expressions and the Else fallback; connect each desired branch to its downstream block.',
      type: 'condition-input',
      layout: 'full',
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    conditions: {
      type: 'json',
      description: 'Ordered condition entries with IDs, titles, and expressions.',
    },
  },
  outputs: {
    conditionResult: {
      type: 'boolean',
      description: 'True when a connected condition or Else path was selected.',
    },
    selectedPath: {
      type: 'json',
      description: 'Selected downstream block metadata, or null when no path is selected.',
    },
    selectedOption: { type: 'string', description: 'Selected condition option ID' },
  },
}
