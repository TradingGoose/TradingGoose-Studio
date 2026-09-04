import type { TriggerConfig } from '@/triggers/types'

export const portfolioStateTrigger: TriggerConfig = {
  id: 'portfolio_state_trigger',
  name: 'Portfolio State Trigger',
  webhookProvider: 'portfolio',
  description: 'Trigger workflow from portfolio monitor state changes',
  version: '1.0.0',
  instructions: [
    'Open `/workspace/[workspaceId]/monitor` and create a portfolio monitor.',
    'Select the broker account, portfolio condition, and workflow target.',
    'Choose `edge` to run only when the condition changes from false to true, or `while_true` to run repeatedly while it remains true, subject to the cooldown.',
    'The polling interval defaults to 60 seconds and accepts 15–3600 seconds. The cooldown defaults to 300 seconds and accepts 0–86400 seconds.',
  ],
  subBlocks: [
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      type: 'text',
      mode: 'trigger',
      defaultValue:
        'Portfolio monitors are managed from /workspace/[workspaceId]/monitor. Configure broker account, condition, and workflow target there.',
      readOnly: true,
    },
  ],
  outputs: {
    input: {
      type: 'string',
      description: 'Human-readable summary naming the portfolio whose condition matched.',
    },
    event: {
      type: 'string',
      description: 'Always `portfolio_state_condition_matched`.',
    },
    portfolio: {
      type: 'object',
      description: 'Monitored portfolio identity and the detail snapshot that matched.',
      identity: { type: 'object', description: 'Trading portfolio identity.' },
      detail: { type: 'object', description: 'Portfolio detail snapshot.' },
    },
    monitor: {
      type: 'object',
      description: 'Identifiers for the monitor, target workflow, provider, service, and account.',
      id: { type: 'string', description: 'Portfolio monitor ID.' },
      workflowId: { type: 'string', description: 'Target workflow ID.' },
      blockId: { type: 'string', description: 'Target trigger block ID.' },
      providerId: { type: 'string', description: 'Trading provider ID.' },
      serviceId: { type: 'string', description: 'Connected trading service ID.' },
      accountId: { type: 'string', description: 'Monitored broker account ID.' },
    },
    condition: { type: 'json', description: 'Matched portfolio fire condition.' },
  },
}
