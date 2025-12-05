import { z } from 'zod'
import { COPILOT_VERSION } from './constants'
import { COPILOT_MODE_IDS } from '../modes'

export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  workflowId: z.string().min(1),
  userId: z.string().min(1),
  stream: z.boolean().default(true),
  streamToolCalls: z.boolean().default(true),
  model: z.string().optional(),
  mode: z.enum(COPILOT_MODE_IDS).default('agent'),
  messageId: z.string().optional(),
  version: z.string().optional().default(COPILOT_VERSION),
  provider: z.any().optional(),
  conversationId: z.string().optional(),
  prefetch: z.boolean().optional(),
  userName: z.string().optional(),
  context: z
    .array(
      z.object({
        type: z.string(),
        tag: z.string().optional(),
        content: z.string(),
      })
    )
    .optional(),
  chatId: z.string().optional(),
  fileAttachments: z.any().optional(),
})

export const ContextUsageSchema = z.object({
  chatId: z.string(),
  model: z.string(),
  workflowId: z.string(),
  userId: z.string(),
  provider: z.any().optional(),
})

export const MarkCompleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.number(),
  message: z.any().optional(),
  data: z.any().optional(),
})

export const StatsSchema = z.object({
  messageId: z.string(),
  diffCreated: z.boolean(),
  diffAccepted: z.boolean(),
})
