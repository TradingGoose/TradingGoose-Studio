'use client'

import { COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS } from '../../workspace-entities'
import type { MentionOption, MentionSubmenu } from './types'

export const MENTION_OPTIONS: readonly MentionOption[] = [
  'chats',
  ...COPILOT_WORKSPACE_ENTITY_MENTION_OPTIONS,
  'blocks',
  'docs',
  'logs',
]

export const MENTION_SUBMENUS: readonly MentionSubmenu[] = MENTION_OPTIONS.filter(
  (option): option is MentionSubmenu => option !== 'docs'
)

export const MAX_TEXTAREA_HEIGHT = 120
export const MAX_MENTION_MENU_HEIGHT = 360
