import { HumanInTheLoopIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import type { ResponseBlockOutput } from '@/tools/response/types'

export const HumanInTheLoopBlock: BlockConfig<ResponseBlockOutput> = {
  type: 'human_in_the_loop',
  name: 'Human in the Loop',
  description: 'Pause workflow execution and wait for human input',
  longDescription:
    'Combines response and start functionality. Sends structured responses and allows workflow to resume from this point.',
  category: 'blocks',
  bgColor: '#10B981',
  docsLink: 'https://docs.tradinggoose.ai/blocks/human-in-the-loop',
  icon: HumanInTheLoopIcon,
  subBlocks: [
    {
      id: 'builderData',
      title: 'Display Data',
      type: 'response-format',
      description:
        'Define the structure of your response data. Use <variable.name> in field names to reference workflow variables.',
    },
    {
      id: 'notification',
      title: 'Notification (Send URL)',
      type: 'tool-input',
      description: 'Configure notification tools to alert approvers (e.g., Slack, Email)',
      defaultValue: [],
    },
    {
      id: 'inputFormat',
      title: 'Resume Form',
      type: 'input-format',
      description: 'Define the fields the approver can fill in when resuming',
    },
  ],
  tools: { access: [] },
  inputs: {
    inputFormat: {
      type: 'json',
      description: 'Input fields for resume',
    },
    notification: {
      type: 'json',
      description: 'Notification tools configuration',
    },
    builderData: {
      type: 'json',
      description: 'Structured response data',
    },
  },
  outputs: {
    url: { type: 'string', description: 'Resume UI URL' },
    resumeEndpoint: {
      type: 'string',
      description: 'Resume API endpoint URL for direct curl requests',
    },
  },
}
