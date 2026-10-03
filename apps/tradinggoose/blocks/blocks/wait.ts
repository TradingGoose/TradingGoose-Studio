import type { SVGProps } from 'react'
import { createElement } from 'react'
import { PauseCircle } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'

const WaitIcon = (props: SVGProps<SVGSVGElement>) => createElement(PauseCircle, props)

export const WaitBlock: BlockConfig = {
  type: 'wait',
  name: 'Wait',
  description: 'Pause workflow execution for a specified time delay',
  longDescription:
    'Delay the current execution path by a positive number of seconds or minutes, up to 600 seconds or 10 minutes. The default is 10 seconds. The runtime parses the amount as an integer, so use whole numbers. This is an in-process delay, not a persisted human-approval pause. Browser execution checks for cancellation during the wait; server execution uses a single sleep and does not interrupt it mid-flight.',
  bestPractices: `
  - Use for simple time delays (max 10 minutes)
  - Configure the wait amount and unit (seconds or minutes)
  - Time-based waits are interruptible via workflow cancellation
  - Enter a positive number for the wait amount
  `,
  category: 'blocks',
  bgColor: '#F59E0B',
  icon: WaitIcon,
  docsLink: 'https://docs.tradinggoose.ai/blocks/wait',
  subBlocks: [
    {
      id: 'timeValue',
      title: 'Wait Amount',
      type: 'short-input',
      inputType: 'number',
      layout: 'half',
      description: 'Max: 600 seconds or 10 minutes',
      placeholder: '10',
      value: () => '10',
      required: true,
    },
    {
      id: 'timeUnit',
      title: 'Unit',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Seconds', id: 'seconds' },
        { label: 'Minutes', id: 'minutes' },
      ],
      value: () => 'seconds',
      required: true,
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    timeValue: {
      type: 'string',
      description: 'Wait duration value',
    },
    timeUnit: {
      type: 'string',
      description: 'Wait duration unit (seconds or minutes)',
    },
  },
  outputs: {
    waitDuration: {
      type: 'number',
      description: 'Wait duration in milliseconds',
    },
    status: {
      type: 'string',
      description:
        'completed after the delay, or cancelled when a browser-side wait is interrupted.',
    },
  },
}
