import { Play } from 'lucide-react'
import type { TriggerConfig } from '@/triggers/types'

export const manualTrigger: TriggerConfig = {
  id: 'manual',
  name: 'Manual',
  provider: 'core',
  description: 'Start workflow manually from the editor',
  version: '1.0.0',
  icon: Play,
  subBlocks: [],
  outputs: {},
}
