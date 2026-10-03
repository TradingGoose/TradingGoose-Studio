import { WorkflowIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'

export const WorkflowBlock: BlockConfig = {
  type: 'workflow',
  name: 'Workflow',
  description:
    'This is a core workflow block. Execute another workflow as a block in your workflow. Enter the input variable to pass to the child workflow.',
  longDescription:
    'This hidden block type is not offered in the block toolbar; use the Workflow block with Input Mapping for new workflows. The selected input value is passed directly as the child workflow input. The parent waits for the child and exposes the child output under result. The execution target follows the parent: deployed parents run deployed children, and live parents run live children. Child failures fail this block, and nested workflow execution is limited to 10 levels.',
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
      description: 'Value passed directly as the child workflow input.',
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
    childTraceSpans: { type: 'array', description: 'Trace spans from the child execution.' },
  },
  hideFromToolbar: true,
}
