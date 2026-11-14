import { z } from 'zod'

const id = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'A nonblank identifier is required')
const base = { label: z.string(), workspaceId: id.optional() }
/** Canonical Studio UI locators. Each underlying entity reader still authorizes the actual actor. */
export const ChatContextSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('past_chat'),
      threadId: id,
      workspaceId: id.nullable(),
      label: z.string(),
    })
    .strict(),
  z.object({ ...base, kind: z.literal('workflow'), workflowId: id }).strict(),
  z.object({ ...base, kind: z.literal('skill'), skillId: id }).strict(),
  z.object({ ...base, kind: z.literal('indicator'), indicatorId: id }).strict(),
  z
    .object({ ...base, kind: z.literal('knowledge_base'), knowledgeBaseId: id, workspaceId: id })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('current_knowledge_base'),
      knowledgeBaseId: id,
      workspaceId: id,
    })
    .strict(),
  z.object({ ...base, kind: z.literal('custom_tool'), customToolId: id }).strict(),
  z.object({ ...base, kind: z.literal('mcp_server'), mcpServerId: id }).strict(),
  z.object({ ...base, kind: z.literal('watchlist'), watchlistId: id }).strict(),
  z
    .object({
      ...base,
      kind: z.literal('dashboard_layout'),
      dashboardLayoutId: id,
      workspaceId: id,
      ownerUserId: id,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('current_dashboard_layout'),
      dashboardLayoutId: id,
      workspaceId: id,
      ownerUserId: id,
    })
    .strict(),
  z
    .object({ kind: z.literal('blocks'), label: z.string(), blockTypes: z.array(id).optional() })
    .strict(),
  z.object({ kind: z.literal('logs'), label: z.string(), workspaceId: id, logId: id }).strict(),
  z
    .object({ kind: z.literal('current_logs'), label: z.string(), workspaceId: id, logId: id })
    .strict(),
  z
    .object({
      kind: z.literal('current_monitor'),
      label: z.string(),
      workspaceId: id,
      monitorId: id,
    })
    .strict(),
  z
    .object({ kind: z.literal('workflow_block'), label: z.string(), workflowId: id, blockId: id })
    .strict(),
  z.object({ kind: z.literal('docs'), label: z.string() }).strict(),
])

export type ChatContext = z.infer<typeof ChatContextSchema>
