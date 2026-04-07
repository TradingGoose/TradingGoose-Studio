import type { BlockState } from '@/stores/workflows/workflow/types'
import { normalizeStringArray } from '@/lib/utils'

export const CHAT_PRIMARY_COLOR = 'var(--primary-hover)'
export const DEFAULT_CHAT_WELCOME_MESSAGE = 'Hi there! How can I help you today?'

export const CHAT_TRIGGER_SUBBLOCK_IDS = {
  identifier: 'identifier',
  title: 'title',
  description: 'description',
  authType: 'authType',
  password: 'password',
  allowedEmails: 'emails',
  welcomeMessage: 'welcomeMessage',
  selectedOutputBlocks: 'selectedOutputBlocks',
  imageUrl: 'imageUrl',
} as const

export type ChatAuthType = 'public' | 'password' | 'email' | 'sso'

export interface ChatOutputConfig {
  blockId: string
  path: string
}

export interface ChatDeploymentDraftConfig {
  identifier: string
  title: string
  description: string
  authType: ChatAuthType
  encryptedPassword: string | null
  allowedEmails: string[]
  welcomeMessage: string
  selectedOutputBlocks: string[]
  imageUrl: string | null
}

const CHAT_AUTH_TYPES = new Set<ChatAuthType>(['public', 'password', 'email', 'sso'])

const toTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

const toOptionalTrimmedString = (value: unknown): string | null => {
  const trimmed = toTrimmedString(value)
  return trimmed.length > 0 ? trimmed : null
}

export const isChatIdentifierFormatValid = (identifier: string): boolean =>
  /^[a-z0-9-]+$/.test(identifier)

export const normalizeChatAuthType = (value: unknown): ChatAuthType => {
  return typeof value === 'string' && CHAT_AUTH_TYPES.has(value as ChatAuthType)
    ? (value as ChatAuthType)
    : 'public'
}

export const fromChatOutputConfigs = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const blockId = toTrimmedString((entry as Record<string, unknown>).blockId)
      const path = toTrimmedString((entry as Record<string, unknown>).path)
      if (!blockId || !path) {
        return null
      }

      return `${blockId}_${path}`
    })
    .filter((entry): entry is string => Boolean(entry))
}

export const toChatOutputConfigs = (value: unknown): ChatOutputConfig[] => {
  const seen = new Set<string>()

  return normalizeStringArray(value)
    .map((outputId) => {
      const separatorIndex = outputId.indexOf('_')
      if (separatorIndex <= 0 || separatorIndex === outputId.length - 1) {
        return null
      }

      const blockId = outputId.slice(0, separatorIndex).trim()
      const path = outputId.slice(separatorIndex + 1).trim()
      if (!blockId || !path) {
        return null
      }

      const dedupeKey = `${blockId}:${path}`
      if (seen.has(dedupeKey)) {
        return null
      }
      seen.add(dedupeKey)

      return { blockId, path }
    })
    .filter((entry): entry is ChatOutputConfig => Boolean(entry))
}

export const getChatDeploymentDraftFromSubBlocks = (
  subBlocks?: BlockState['subBlocks']
): ChatDeploymentDraftConfig => {
  const values = subBlocks ?? {}

  return {
    identifier: toTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.identifier]?.value),
    title: toTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.title]?.value),
    description: toTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.description]?.value),
    authType: normalizeChatAuthType(values[CHAT_TRIGGER_SUBBLOCK_IDS.authType]?.value),
    encryptedPassword: toOptionalTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.password]?.value),
    allowedEmails: normalizeStringArray(values[CHAT_TRIGGER_SUBBLOCK_IDS.allowedEmails]?.value),
    welcomeMessage:
      toTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.welcomeMessage]?.value) ||
      DEFAULT_CHAT_WELCOME_MESSAGE,
    selectedOutputBlocks: normalizeStringArray(
      values[CHAT_TRIGGER_SUBBLOCK_IDS.selectedOutputBlocks]?.value
    ),
    imageUrl: toOptionalTrimmedString(values[CHAT_TRIGGER_SUBBLOCK_IDS.imageUrl]?.value),
  }
}

export const getChatDeploymentDraftFromBlock = (
  block?: Pick<BlockState, 'subBlocks'> | null
): ChatDeploymentDraftConfig | null => {
  if (!block) {
    return null
  }

  return getChatDeploymentDraftFromSubBlocks(block.subBlocks)
}

export const hasAnyChatDeploymentDraftValue = (
  draft: ChatDeploymentDraftConfig | null | undefined
): boolean => {
  if (!draft) {
    return false
  }

  return Boolean(
    draft.identifier ||
      draft.title ||
      draft.description ||
      draft.authType !== 'public' ||
      draft.encryptedPassword ||
      draft.allowedEmails.length > 0 ||
      draft.welcomeMessage !== DEFAULT_CHAT_WELCOME_MESSAGE ||
      draft.selectedOutputBlocks.length > 0 ||
      draft.imageUrl
  )
}

export const isChatDeploymentDraftConfigured = (
  draft: ChatDeploymentDraftConfig | null | undefined,
  options?: {
    hasPasswordFallback?: boolean
  }
): boolean => {
  if (!draft) {
    return false
  }

  if (!draft.identifier || !isChatIdentifierFormatValid(draft.identifier)) {
    return false
  }

  if (!draft.title) {
    return false
  }

  if (draft.selectedOutputBlocks.length === 0) {
    return false
  }

  if (draft.authType === 'password') {
    return Boolean(draft.encryptedPassword || options?.hasPasswordFallback)
  }

  if (draft.authType === 'email' || draft.authType === 'sso') {
    return draft.allowedEmails.length > 0
  }

  return true
}
