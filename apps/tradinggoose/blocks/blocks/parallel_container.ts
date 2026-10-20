import { createElement } from 'react'
import { SplitIcon } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

export const ParallelContainerBlock: BlockConfig = {
  type: 'parallel',
  name: 'Parallel',
  description: 'Execute copies of a workflow container concurrently.',
  longDescription:
    'Parallel Count runs between 1 and 20 copies of its child blocks. Parallel Each creates one execution per array item or object entry; the count-mode limit of 20 does not cap collection mode. Child executions share the workflow variable namespace, so concurrent writes are not isolated. Connect the container start to its first child and the container end to the downstream path. After all executions finish, results are aggregated in iteration-index order, not completion order. For object collections, each item is a key/value pair.',
  bestPractices:
    'Keep child blocks inside the parallel container. Incoming outer workflow edges target the Parallel block alias itself, not Parallel Start or Parallel End. Parallel Start only connects from the parallel container to child blocks. Child outputs reconnect to Parallel End before leaving the container.',
  category: 'blocks',
  icon: (props) => createElement(SplitIcon, props),
  bgColor: '#ffdd00',
  subBlocks: [
    {
      id: 'parallelType',
      title: 'Parallel Type',
      type: 'dropdown',
      supportsReferences: false,
      description: 'Choose a fixed execution count or one execution per collection item.',
      defaultValue: 'count',
      options: [
        { id: 'count', label: 'Parallel Count' },
        { id: 'collection', label: 'Parallel Each' },
      ],
    },
    {
      id: 'count',
      title: 'Executions',
      type: 'short-input',
      inputType: 'number',
      required: true,
      supportsReferences: false,
      integer: true,
      min: 1,
      max: 20,
      defaultValue: 5,
      description: 'Number of parallel executions in count mode; integer from 1 to 20.',
      condition: { field: 'parallelType', value: 'count' },
    },
    {
      id: 'distribution',
      title: 'Collection',
      type: 'long-input',
      defaultValue: '',
      description:
        'Array or object in collection mode. Accepts an array, object, JSON text, or an exact upstream reference such as <function.result>. Each item starts an execution; object entries become key/value pairs.',
      placeholder: 'Enter an array, object, or upstream reference',
      condition: { field: 'parallelType', value: 'collection' },
    },
  ],
  tools: { access: [] },
  inputs: {
    parallelType: { type: 'string', description: 'count or collection.' },
    count: {
      type: 'number',
      description: 'Number of executions in count mode; integer from 1 to 20.',
    },
    distribution: {
      type: 'json',
      description: 'Array or object for collection mode; supports upstream references.',
    },
  },
  outputs: {
    parallelId: { type: 'string', description: 'Parallel container ID.' },
    parallelCount: { type: 'number', description: 'Number of parallel executions.' },
    completed: { type: 'boolean', description: 'True once all executions have completed.' },
    results: {
      type: 'array',
      description: 'Completed execution results in iteration-index order.',
    },
    message: { type: 'string', description: 'Parallel progress message.' },
  },
}
