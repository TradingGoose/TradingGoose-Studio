import type { SVGProps } from 'react'
import { createElement } from 'react'
import { BriefcaseBusiness } from 'lucide-react'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const PortfolioStateTriggerIcon = (props: SVGProps<SVGSVGElement>) =>
  createElement(BriefcaseBusiness, props)

export const PortfolioStateTriggerBlock: BlockConfig = {
  type: 'portfolio_state_trigger',
  name: 'Portfolio Monitor',
  description:
    'Trigger workflow from portfolio monitor events managed in /workspace/[workspaceId]/monitor.',
  category: 'triggers',
  icon: PortfolioStateTriggerIcon,
  bgColor: '#2563EB',
  bestPractices: `
  - Configure and manage monitors in /workspace/[workspaceId]/monitor.
  - Use this trigger block to expose portfolio snapshot and matched condition fields.
  - Keep broker credential, account, and fire-condition settings out of workflow trigger subblocks.
  `,
  subBlocks: [...(getTrigger('portfolio_state_trigger')?.subBlocks ?? [])],
  tools: {
    access: [],
  },
  inputs: {},
  outputs: (getTrigger('portfolio_state_trigger')?.outputs ??
    {}) as unknown as BlockConfig['outputs'],
  triggers: {
    enabled: true,
    available: ['portfolio_state_trigger'],
  },
}
