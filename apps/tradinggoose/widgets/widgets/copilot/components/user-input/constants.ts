'use client'

import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import { COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS } from '../../workspace-entities'
import type { MentionOption, MentionSubmenu } from './types'

export const BRAIN_MODELS: readonly CopilotRuntimeModel[] = ['gpt-5.4', 'claude-sonnet-4.6']
export const BRAIN_CIRCUIT_MODELS: readonly CopilotRuntimeModel[] = ['claude-opus-4.6']
export const FAST_MODELS: readonly CopilotRuntimeModel[] = ['gpt-5.4-mini']
export const ANTHROPIC_MODELS: readonly CopilotRuntimeModel[] = [
  'claude-sonnet-4.6',
  'claude-opus-4.6',
]
export const OPENAI_MODELS: readonly CopilotRuntimeModel[] = ['gpt-5.4', 'gpt-5.4-mini']

export const MENTION_OPTIONS: readonly MentionOption[] = [
  'Chats',
  ...COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS,
  'Workflow Blocks',
  'Blocks',
  'Knowledge',
  'Docs',
  'Logs',
]

export const MENTION_SUBMENUS: readonly MentionSubmenu[] = MENTION_OPTIONS.filter(
  (option): option is MentionSubmenu => option !== 'Docs'
)

export const MAX_TEXTAREA_HEIGHT = 120
export const MAX_MENTION_MENU_HEIGHT = 360
