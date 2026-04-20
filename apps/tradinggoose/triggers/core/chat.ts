import { MessageCircle } from 'lucide-react'
import {
  CHAT_TRIGGER_SUBBLOCK_IDS,
  DEFAULT_CHAT_WELCOME_MESSAGE,
} from '@/lib/chat/deployment-config'
import type { TriggerConfig } from '@/triggers/types'

export const chatTrigger: TriggerConfig = {
  id: 'chat',
  name: 'Chat',
  webhookProvider: 'core',
  description: 'Start workflow from a chat deployment',
  version: '1.0.0',
  icon: MessageCircle,
  subBlocks: [
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.identifier,
      title: 'Identifier',
      type: 'short-input',
      mode: 'trigger',
      required: true,
      placeholder: 'company-name',
      description: 'Public path segment used for the published chat URL.',
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.title,
      title: 'Chat Title',
      type: 'short-input',
      mode: 'trigger',
      required: true,
      placeholder: 'Customer Support Assistant',
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.description,
      title: 'Description',
      type: 'long-input',
      mode: 'trigger',
      placeholder: 'A brief description of what this chat does',
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.selectedOutputBlocks,
      title: 'Chat Output',
      type: 'checkbox-list',
      mode: 'trigger',
      required: true,
      options: [],
      description: 'Which workflow outputs should be returned to the user.',
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.authType,
      title: 'Access Control',
      type: 'dropdown',
      mode: 'trigger',
      defaultValue: 'public',
      options: [
        { id: 'public', label: 'Public Access' },
        { id: 'password', label: 'Password Protected' },
        { id: 'email', label: 'Email Access' },
        { id: 'sso', label: 'SSO Access' },
      ],
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.password,
      title: 'Password',
      type: 'short-input',
      mode: 'trigger',
      password: true,
      required: {
        field: CHAT_TRIGGER_SUBBLOCK_IDS.authType,
        value: 'password',
      },
      condition: {
        field: CHAT_TRIGGER_SUBBLOCK_IDS.authType,
        value: 'password',
      },
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.allowedEmails,
      title: 'Allowed Emails',
      type: 'checkbox-list',
      mode: 'trigger',
      options: [],
      required: {
        field: CHAT_TRIGGER_SUBBLOCK_IDS.authType,
        value: ['email', 'sso'],
      },
      condition: {
        field: CHAT_TRIGGER_SUBBLOCK_IDS.authType,
        value: ['email', 'sso'],
      },
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.welcomeMessage,
      title: 'Welcome Message',
      type: 'long-input',
      mode: 'trigger',
      defaultValue: DEFAULT_CHAT_WELCOME_MESSAGE,
    },
    {
      id: CHAT_TRIGGER_SUBBLOCK_IDS.imageUrl,
      title: 'Chat Logo',
      type: 'short-input',
      mode: 'trigger',
      placeholder: '/api/files/serve/...',
    },
  ],
  outputs: {
    input: { type: 'string', description: 'User message' },
    conversationId: { type: 'string', description: 'Conversation ID' },
    files: { type: 'files', description: 'Uploaded files' },
  },
}
