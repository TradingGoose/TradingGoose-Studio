import { WorkflowIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'

export const WorkflowBlock: BlockConfig = {
  type: 'workflow',
  name: 'Workflow',
  description:
    'This is a core workflow block. Execute another workflow as a block in your workflow. Enter the input variable to pass to the child workflow.',
  category: 'blocks',
  bgColor: '#705335',
  icon: WorkflowIcon,
  subBlocks: [
    {
      id: 'workflowId',
      title: 'Select Workflow',
      type: 'dropdown',
      required: true,
    },
    {
      id: 'input',
      title: 'Input Variable (Optional)',
      type: 'short-input',
      placeholder: 'Select a variable to pass to the child workflow',
      description: 'This variable will be available as start.input in the child workflow',
      required: false,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    workflowId: {
      type: 'string',
      description: 'ID of the workflow to execute',
    },
    input: {
      type: 'string',
      description: 'Variable reference to pass to the child workflow',
    },
  },
  outputs: {
    success: { type: 'boolean', description: 'Execution success status' },
    childWorkflowName: { type: 'string', description: 'Child workflow name' },
    result: { type: 'json', description: 'Workflow execution result' },
    error: { type: 'string', description: 'Error message' },
  },
  hideFromToolbar: true,
}
