import { z } from 'zod'

const McpServerBaseSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  transport: z.enum(['http', 'sse', 'streamable-http']),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  enabled: z.boolean().optional(),
})

export const CreateMcpServerSchema = McpServerBaseSchema.refine(
  (server) => server.enabled === false || !!server.url?.trim(),
  {
    message: 'URL is required when an MCP server is enabled',
    path: ['url'],
  }
)

export const RenameMcpServerSchema = z.object({
  name: z.string().trim().min(1),
  workspaceId: z.string().optional(),
})
