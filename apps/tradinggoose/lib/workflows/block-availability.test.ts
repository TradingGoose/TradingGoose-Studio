import { describe, expect, it } from 'vitest'
import type { BlockConfig } from '@/blocks/types'
import { getProviderIdsForBlocks, isBlockAvailable } from '@/lib/workflows/block-availability'

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
})
