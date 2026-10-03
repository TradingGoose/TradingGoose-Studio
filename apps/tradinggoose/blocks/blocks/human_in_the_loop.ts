import { HumanInTheLoopIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'

export const HumanInTheLoopBlock: BlockConfig = {
  type: 'human_in_the_loop',
  name: 'Human in the Loop',
  description: 'Pause workflow execution and wait for human input',
  longDescription:
    'Saves a durable workflow checkpoint and waits for a workspace member with write permission to submit the Resume Form. The current execution layer finishes before pausing; all approval and child-workflow waits at that checkpoint must be satisfied before execution continues. Resumption preserves the original workflow version, execution identity, actor, variables, outputs, and loop/parallel position without replaying completed blocks. Form fields become top-level outputs after resumption. Field names cannot use url, resumeEndpoint, error, stream, execution, response, or JavaScript prototype keys. Review links require authentication; possessing a URL does not grant approval permission. For API review, GET resumeEndpoint to read the current checkpoint, then POST application/json with revision, pausePointId, and input. The server validates the submitted input against the Resume Form. The endpoint is /api/resume/[workflowId]/[executionId] and accepts a user session or API key with access to the workflow workspace. Notification tools run after persistence and can reference this block’s url or resumeEndpoint. Notification failure does not bypass approval. Paused workflows can be cancelled through the job API.',
  category: 'blocks',
  bgColor: '#10B981',
  docsLink: 'https://docs.tradinggoose.ai/blocks/human_in_the_loop',
  icon: HumanInTheLoopIcon,
  subBlocks: [
    {
      id: 'builderData',
      title: 'Display Data',
      type: 'response-format',
      description:
        'Data shown to the reviewer. Use upstream block or workflow variable references in field values.',
    },
    {
      id: 'notification',
      title: 'Notification (Send URL)',
      type: 'tool-input',
      description:
        'Optional notification tools. Reference this block’s url or resumeEndpoint in tool parameters; notifications are dispatched only after the checkpoint is saved.',
      defaultValue: [],
    },
    {
      id: 'inputFormat',
      title: 'Resume Form',
      type: 'input-format',
      description:
        'Fields validated by the server on submission. Names must be unique and cannot replace review links, runtime control fields, or JavaScript prototype keys. Submitted fields become this block’s outputs.',
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
