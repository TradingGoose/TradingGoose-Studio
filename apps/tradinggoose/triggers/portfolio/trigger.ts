import type { TriggerConfig } from '@/triggers/types'

export const portfolioStateTrigger: TriggerConfig = {
  id: 'portfolio_state_trigger',
  name: 'Portfolio State Trigger',
  webhookProvider: 'portfolio',
  description: 'Trigger workflow from portfolio monitor state changes',
  version: '1.0.0',
  subBlocks: [
    {
      id: 'triggerInstructions',
      title: 'Setup',
      type: 'text',
      mode: 'trigger',
      defaultValue:
        'Portfolio monitors are managed from /workspace/[workspaceId]/monitor. Configure broker account, condition, and workflow target there.',
      readOnly: true,
    },
  ],
  outputs: {
    input: { type: 'string', description: 'Primary workflow text input.' },
    event: { type: 'string', description: 'Portfolio monitor event key.' },
    portfolio: {
      identity: { type: 'object', description: 'Trading portfolio identity.' },
      detail: { type: 'object', description: 'Portfolio detail snapshot.' },
    },
    monitor: {
      id: { type: 'string', description: 'Monitor id.' },
      providerId: { type: 'string', description: 'Trading provider id.' },
      serviceId: { type: 'string', description: 'Trading service id.' },
      accountId: { type: 'string', description: 'Trading account id.' },
    },
    condition: { type: 'json', description: 'Matched portfolio fire condition.' },
  },
}
