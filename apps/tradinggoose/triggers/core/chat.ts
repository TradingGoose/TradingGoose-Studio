import { MessageCircle } from 'lucide-react'
import type { TriggerConfig } from '@/triggers/types'

export const chatTrigger: TriggerConfig = {
  id: 'chat',
  name: 'Chat',
  provider: 'core',
  description: 'Start workflow from a chat deployment',
  version: '1.0.0',
  icon: MessageCircle,
  subBlocks: [],
  outputs: {
    input: { type: 'string', description: 'User message' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    files: { type: 'files', description: 'Uploaded files' },
  },
}
