import { Variable } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'

export const VariablesBlock: BlockConfig = {
  type: 'variables',
  name: 'Variables',
  description: 'Set workflow-scoped variables',
  longDescription:
    'Create variables in the Workflow Variables widget, then select them here to update their values during execution. Supported types are plain, number, boolean, object, array, and listingIdentity. Reference a value with an exact tag such as <variable.riskLimit>. Updates apply to this execution, not future runs. All Variables blocks and parallel branches share the workflow variable namespace. Each assignment is also returned as a dynamically named top-level block output. An assignment to an unknown variable does not create a workflow variable.',
  bgColor: '#8B5CF6',
  bestPractices: `
  - Variables are workflow-scoped and persist throughout execution (but not between executions)
  - Reference variables using exact tags like <variable.riskLimit> in any block
  - Variable names should be descriptive and follow camelCase or snake_case convention
  - Any Variables block can update existing variables by setting the same variable name
  - Variables do not appear as block outputs - they're accessed via the <variable.> prefix
  `,
  icon: Variable,
  category: 'blocks',
  docsLink: 'https://docs.tradinggoose.ai/blocks/variables',
  subBlocks: [
    {
      id: 'variables',
      title: 'Variable Assignments',
      type: 'variables-input',
      layout: 'full',
      description:
        'Select workflow variables and update their values during execution. Access them anywhere using exact tags like <variable.riskLimit>.',
      required: false,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    variables: {
      type: 'json',
      description: 'Assignment entries with variableId, variableName, type, and value.',
    },
  },
  outputs: {
    // Dynamic outputs - each assigned variable will be available as a top-level output
    // For example, if you assign variable1=5, you can reference it as <variables_block.variable1>
  },
}
