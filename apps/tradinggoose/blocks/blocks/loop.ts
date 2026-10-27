import { createElement } from 'react'
import { RepeatIcon } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

export const LoopBlock: BlockConfig = {
  type: 'loop',
  name: 'Loop',
  description: 'Repeat the blocks inside a workflow container sequentially.',
  longDescription:
    'For Loop repeats a configured number of times. For Each iterates over a non-empty array or object; object items are key/value pairs. While tests its condition before each iteration, and Do While always executes its first iteration. Conditions use the same expression evaluator as Condition blocks. While and Do While have no fixed iteration cap: provide a terminating condition and account for workflow timeout and execution limits. Connect the container start to its first child and the container end to the blocks that should run afterward. Completed For and For Each loops aggregate child outputs under results in iteration order; a single iteration can contain multiple child outputs. While and Do While completion outputs do not include that results array.',
  bestPractices:
    'Keep child blocks inside the loop container. Incoming outer workflow edges target the Loop block alias itself, not Loop Start or Loop End. Loop Start only connects from the loop container to child blocks. Child outputs reconnect to Loop End before leaving the container.',
  category: 'blocks',
  icon: (props) => createElement(RepeatIcon, props),
  bgColor: '#00ccff',
  subBlocks: [
    {
      id: 'loopType',
      title: 'Loop Type',
      type: 'dropdown',
      supportsReferences: false,
      description: 'Choose a fixed count, collection, pre-test condition, or post-test condition.',
      defaultValue: 'for',
      options: [
        { id: 'for', label: 'For Loop' },
        { id: 'forEach', label: 'For Each' },
        { id: 'while', label: 'While' },
        { id: 'doWhile', label: 'Do While' },
      ],
    },
    {
      id: 'iterations',
      title: 'Iterations',
      type: 'short-input',
      inputType: 'number',
      required: true,
      supportsReferences: false,
      integer: true,
      min: 1,
      max: 100,
      defaultValue: 5,
      description: 'Number of sequential iterations in For Loop mode; integer from 1 to 100.',
      condition: { field: 'loopType', value: 'for' },
    },
    {
      id: 'forEachItems',
      title: 'Collection',
      type: 'long-input',
      defaultValue: '',
      description:
        'Non-empty array or object in For Each mode. Accepts an array, object, JSON text, or an exact upstream reference such as <function.result>. Object entries become key/value pairs.',
      placeholder: 'Enter an array, object, or upstream reference',
      condition: { field: 'loopType', value: 'forEach' },
    },
    {
      id: 'whileCondition',
      title: 'Condition',
      type: 'long-input',
      defaultValue: '',
      description:
        'Boolean expression for While or Do While. <loop.index> is the zero-based index of the iteration being tested. Supports upstream and workflow variable references; provide a terminating condition.',
      placeholder: 'Enter a boolean expression',
      condition: { field: 'loopType', value: ['while', 'doWhile'] },
    },
  ],
  tools: { access: [] },
  inputs: {
    loopType: { type: 'string', description: 'for, forEach, while, or doWhile.' },
    iterations: {
      type: 'number',
      description: 'Iteration count for For Loop; integer from 1 to 100.',
    },
    forEachItems: {
      type: 'json',
      description: 'Non-empty array or object for For Each; supports upstream references.',
    },
    whileCondition: { type: 'string', description: 'Boolean expression for While or Do While.' },
  },
  outputs: {
    loopId: { type: 'string', description: 'Loop container ID.' },
    currentIteration: {
      type: 'number',
      description:
        'One-based during loop execution; completed For and For Each outputs use the final zero-based index.',
    },
    maxIterations: {
      type: 'number',
      description:
        'Count or collection length; condition-driven loops use the runtime sentinel Number.MAX_SAFE_INTEGER.',
    },
    loopType: { type: 'string', description: 'Configured loop mode.' },
    completed: { type: 'boolean', description: 'Whether the loop has finished.' },
    results: {
      type: 'array',
      description:
        'Child outputs grouped by iteration after For or For Each completes; absent from While and Do While completion outputs.',
    },
    message: { type: 'string', description: 'Loop progress message.' },
  },
}
