import { z } from 'zod'
import type { CopilotFileAttachment } from '@/lib/uploads/contexts/copilot/copilot-file-manager'
import { type CopilotRequest, CopilotRequestSchema, type Input } from './contract'

type StudioRequest<T> = T extends CopilotRequest
  ? Omit<T, 'scope' | 'input'> & { workspaceId: string | null } & (T extends { command: 'message' }
        ? {
            input: Omit<Input, 'content'> & { content: string }
            fileAttachments?: CopilotFileAttachment[]
          }
        : unknown)
  : never
export type StudioNativeCommand = StudioRequest<CopilotRequest>

const fileAttachment = z
  .object({
    key: z.string().min(1),
    sourceProof: z.string().min(1),
    filename: z.string().optional(),
    media_type: z.string().optional(),
    size: z.number().int().positive().optional(),
  })
  .strict()
const commands = CopilotRequestSchema.options.map((schema) => {
  const { scope: _scope, ...shape } = schema.shape
  const browser = z.object({ ...shape, workspaceId: z.string().min(1).nullable() }).strict()
  if (schema.shape.command.value !== 'message') return browser
  return browser.extend({
    input: z
      .object({
        content: z.string(),
        contexts: z.array(z.unknown()).optional(),
        attachments: z.array(z.object({ name: z.string(), text: z.string() }).strict()).optional(),
      })
      .strict(),
    fileAttachments: z.array(fileAttachment).optional(),
  })
})
const validator = z.union([commands[0]!, ...commands.slice(1)])
export async function parseStudioNativeCommand(value: unknown): Promise<StudioNativeCommand> {
  return validator.parse(value) as StudioNativeCommand
}
