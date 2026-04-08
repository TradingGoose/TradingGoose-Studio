import { z } from 'zod'

/**
 * Base schema for MCP server fields shared between create and update operations.
 * `name` and `transport` are required here; the update schema derives from this via `.partial()`.
 */
const McpServerBaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  transport: z.string().min(1),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  enabled: z.boolean().optional(),
})

/**
 * Schema for creating a new MCP server.
 * `name` and `transport` are required; `id` is optional (auto-generated if omitted).
 */
export const CreateMcpServerSchema = McpServerBaseSchema.extend({
  id: z.string().optional(),
})

/**
 * Schema for updating an existing MCP server.
 * All fields are optional. `description`, `url`, and `command` additionally accept null
 * so that clients can explicitly clear those fields.
 */
export const UpdateMcpServerSchema = McpServerBaseSchema.partial().extend({
  description: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
  command: z.string().optional().nullable(),
  workspaceId: z.string().optional(),
})
