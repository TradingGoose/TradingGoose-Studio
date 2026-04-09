import { ApiIcon } from '@/components/icons/icons'
import type { TriggerConfig } from '@/triggers/types'

export const apiTrigger: TriggerConfig = {
  id: 'api',
  name: 'API',
  webhookProvider: 'core',
  description: 'Start workflow via authenticated HTTP requests',
  version: '1.0.0',
  icon: ApiIcon,
  subBlocks: [
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      layout: 'full',
      description: 'Define the JSON input schema accepted by the API endpoint.',
      mode: 'trigger',
    },
  ],
  outputs: {},
}
