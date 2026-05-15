import { describe, expect, it } from 'vitest'
import { getProviderIdsForBlocks, isBlockAvailable } from '@/lib/workflows/block-availability'
import type { BlockConfig } from '@/blocks/types'

const onedriveBlock = {
  id: 'onedrive-block',
  name: 'OneDrive',
  description: 'Test block',
  longDescription: 'Test block',
  docsLink: '',
  category: 'Data Sources',
  bgColor: '#fff',
  icon: 'Folder',
  subBlocks: [
    {
      id: 'credential',
      title: 'Credential',
      type: 'oauth-input',
      provider: 'microsoft',
      serviceId: 'onedrive',
      required: true,
      requiredScopes: [],
    },
  ],
} as unknown as BlockConfig

const githubWebhookTriggerBlock = {
  id: 'github-webhook-trigger-block',
  name: 'GitHub Webhook Trigger',
  description: 'Test trigger block',
  longDescription: 'Test trigger block',
  docsLink: '',
  category: 'triggers',
  bgColor: '#fff',
  icon: 'Webhook',
  subBlocks: [
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      required: false,
    },
  ],
} as unknown as BlockConfig

const slackBlock = {
  id: 'slack-block',
  name: 'Slack',
  description: 'Test block',
  category: 'tools',
  bgColor: '#fff',
  icon: 'Message',
  subBlocks: [
    {
      id: 'authMethod',
      type: 'dropdown',
      options: [
        { id: 'oauth', label: 'TradingGoose Bot' },
        { id: 'bot_token', label: 'Custom Bot' },
      ],
    },
    {
      id: 'credential',
      title: 'Slack Account',
      type: 'oauth-input',
      provider: 'slack',
      serviceId: 'slack',
      condition: { field: 'authMethod', value: 'oauth' },
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      condition: { field: 'authMethod', value: 'bot_token' },
    },
  ],
} as unknown as BlockConfig

const multiServiceBlock = {
  id: 'multi-service-block',
  name: 'Multi Service',
  description: 'Test block',
  category: 'tools',
  bgColor: '#fff',
  icon: 'Message',
  subBlocks: [
    {
      id: 'credential',
      title: 'Credential',
      type: 'oauth-input',
      serviceIds: ['slack', 'reddit'],
    },
  ],
} as unknown as BlockConfig

describe('block availability', () => {
  it('normalizes oauth requirements to the service provider id', () => {
    expect(getProviderIdsForBlocks([onedriveBlock])).toEqual(['onedrive'])
  })

  it('requires the exact bound service availability instead of the base provider', () => {
    expect(isBlockAvailable(onedriveBlock, { microsoft: true })).toBe(false)
    expect(isBlockAvailable(onedriveBlock, { onedrive: true })).toBe(true)
  })

  it('does not treat webhook transport providers as oauth-gated integrations', () => {
    expect(getProviderIdsForBlocks([githubWebhookTriggerBlock])).toEqual([])
    expect(isBlockAvailable(githubWebhookTriggerBlock, {})).toBe(true)
  })

  it('does not use conditional oauth inputs as block-level availability requirements', () => {
    expect(getProviderIdsForBlocks([slackBlock])).toEqual([])
    expect(isBlockAvailable(slackBlock, {})).toBe(true)
    expect(isBlockAvailable(slackBlock, { slack: false })).toBe(true)
  })

  it('allows service-id alternatives when at least one referenced service is available', () => {
    expect(getProviderIdsForBlocks([multiServiceBlock])).toEqual(['slack', 'reddit'])
    expect(isBlockAvailable(multiServiceBlock, { slack: false, reddit: false })).toBe(false)
    expect(isBlockAvailable(multiServiceBlock, { reddit: true })).toBe(true)
  })
})
