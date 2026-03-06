import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Clock } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const ScheduleIcon = (props: SVGProps<SVGSVGElement>) => createElement(Clock, props)

export const ScheduleBlock: BlockConfig = {
  type: 'schedule',
  triggerAllowed: true,
  name: 'Schedule',
  description: 'Trigger workflow execution on a schedule',
  longDescription:
    'Integrate Schedule into the workflow. Can trigger a workflow on a schedule configuration.',
  bestPractices: `
  - Search up examples with schedule blocks to understand YAML syntax. 
  - Prefer the custom cron expression input method over the other schedule configuration methods. 
  - Clarify the timezone if the user doesn't specify it.
  `,
  category: 'triggers',
  bgColor: '#6366F1',
  icon: ScheduleIcon,

  subBlocks: [...(getTrigger('schedule')?.subBlocks ?? [])],

  tools: {
    access: [], // No external tools needed
  },

  inputs: {}, // No inputs - schedule triggers initiate workflows

  outputs: {}, // No outputs - schedule triggers initiate workflow execution

  triggers: {
    enabled: true,
    available: ['schedule'],
  },
}
