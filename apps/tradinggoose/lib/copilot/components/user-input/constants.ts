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

export const SELECTOR_TRIGGER_CLASS =
  'flex h-auto min-h-6 max-w-full items-center gap-1.5 whitespace-normal rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0'

export const MAX_TEXTAREA_HEIGHT = 120
export const MAX_MENTION_MENU_HEIGHT = 360
