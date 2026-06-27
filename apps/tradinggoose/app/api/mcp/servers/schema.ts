import { z } from 'zod'

const McpServerBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transport: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string().min(1),
  headers: z.record(z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  enabled: z.boolean().optional(),
})

export const CreateMcpServerSchema = McpServerBaseSchema

export const RenameMcpServerSchema = z.object({
  name: z.string().trim().min(1),
  workspaceId: z.string().optional(),
})
