import { chat } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import {
  CHAT_PRIMARY_COLOR,
  type ChatDeploymentDraftConfig,
  getChatDeploymentDraftFromSubBlocks,
  isChatDeploymentDraftConfigured,
  toChatOutputConfigs,
} from '@/lib/chat/deployment-config'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

type DatabaseClient = any
type PublishedChatRow = typeof chat.$inferSelect

interface ChatTriggerDraft {
  blockId: string
  config: ChatDeploymentDraftConfig
}

const getWorkflowBlocks = (state: unknown): Record<string, BlockState> => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return {}
  }

  const blocks = (state as { blocks?: unknown }).blocks
  if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) {
    return {}
  }

  return blocks as Record<string, BlockState>
}

export const hasChatTriggerBlocks = (state?: unknown): boolean => {
  return Object.values(getWorkflowBlocks(state)).some((block) => block?.type === 'chat_trigger')
}

const getChatTriggerDrafts = (state: Pick<WorkflowState, 'blocks'>): ChatTriggerDraft[] => {
  return Object.entries(state.blocks || {})
    .filter((entry): entry is [string, BlockState] => Boolean(entry[1]))
    .filter(([, block]) => block.type === 'chat_trigger')
    .map(([blockId, block]) => ({
      blockId,
      config: getChatDeploymentDraftFromSubBlocks(block.subBlocks),
    }))
}

const resolveExistingPublishedChat = (
  existingChats: PublishedChatRow[],
  blockId: string,
  totalChatTriggerCount: number
): PublishedChatRow | null => {
  const exactMatch = existingChats.find((deployment) => deployment.triggerBlockId === blockId)
  if (exactMatch) {
    return exactMatch
  }

  if (totalChatTriggerCount !== 1) {
    return null
  }

  const legacyRows = existingChats.filter((deployment) => !deployment.triggerBlockId)
  if (legacyRows.length !== 1) {
    return null
  }

  return legacyRows[0]
}

const buildCustomizations = (config: ChatDeploymentDraftConfig) => {
  return {
    primaryColor: CHAT_PRIMARY_COLOR,
    welcomeMessage: config.welcomeMessage,
    ...(config.imageUrl ? { imageUrl: config.imageUrl } : {}),
  }
}

const assertUniqueIdentifier = async (
  tx: DatabaseClient,
  identifier: string,
  currentChatId?: string | null
) => {
  const [existingIdentifier] = await tx
    .select({ id: chat.id })
    .from(chat)
    .where(eq(chat.identifier, identifier))
    .limit(1)

  if (existingIdentifier && existingIdentifier.id !== currentChatId) {
    throw new Error('This identifier is already in use')
  }
}

export async function reconcilePublishedChatsForDeploymentTx({
  tx,
  workflowId,
  workflowOwnerId,
  deploymentVersionId,
  state,
  previousState,
}: {
  tx: DatabaseClient
  workflowId: string
  workflowOwnerId: string
  deploymentVersionId: string
  state: Pick<WorkflowState, 'blocks'>
  previousState?: unknown
}) {
  const drafts = getChatTriggerDrafts(state)
  if (drafts.length === 0 && !hasChatTriggerBlocks(previousState)) {
    return
  }

  const existingChats = await tx.select().from(chat).where(eq(chat.workflowId, workflowId))
  const publishedChatIds = new Set<string>()

  for (const draft of drafts) {
    const existingChat = resolveExistingPublishedChat(existingChats, draft.blockId, drafts.length)
    const hasPasswordFallback = Boolean(
      draft.config.authType === 'password' &&
        existingChat?.authType === 'password' &&
        existingChat.password
    )

    if (!isChatDeploymentDraftConfigured(draft.config, { hasPasswordFallback })) {
      continue
    }

    await assertUniqueIdentifier(tx, draft.config.identifier, existingChat?.id)

    const encryptedPassword =
      draft.config.authType === 'password'
        ? draft.config.encryptedPassword || existingChat?.password || null
        : null

    const values = {
      workflowId,
      triggerBlockId: draft.blockId,
      deploymentVersionId,
      userId: workflowOwnerId,
      identifier: draft.config.identifier,
      title: draft.config.title,
      description: draft.config.description,
      isActive: true,
      customizations: buildCustomizations(draft.config),
      authType: draft.config.authType,
      password: encryptedPassword,
      allowedEmails:
        draft.config.authType === 'email' || draft.config.authType === 'sso'
          ? draft.config.allowedEmails
          : [],
      outputConfigs: toChatOutputConfigs(draft.config.selectedOutputBlocks),
      updatedAt: new Date(),
    }

    if (existingChat) {
      await tx.update(chat).set(values).where(eq(chat.id, existingChat.id))
      publishedChatIds.add(existingChat.id)
      continue
    }

    const id = uuidv4()
    await tx.insert(chat).values({
      id,
      ...values,
      createdAt: new Date(),
    })
    publishedChatIds.add(id)
  }

  for (const existingChat of existingChats) {
    if (publishedChatIds.has(existingChat.id)) {
      continue
    }

    await tx.delete(chat).where(eq(chat.id, existingChat.id))
  }
}

export async function removePublishedChatsForWorkflowTx(tx: DatabaseClient, workflowId: string) {
  await tx.delete(chat).where(eq(chat.workflowId, workflowId))
}
