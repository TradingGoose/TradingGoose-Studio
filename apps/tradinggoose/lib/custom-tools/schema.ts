import { z } from 'zod'

const CUSTOM_TOOL_RUNTIME_PREFIX = 'custom_'
const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')

export function resolveCustomToolRuntimeId({
  id,
  toolId,
}: {
  id?: string | null
  toolId?: string | null
}): string {
  const rawId = (toolId || id || '').trim()
  if (!rawId) throw new Error('Custom tool id is required')
  return rawId.startsWith(CUSTOM_TOOL_RUNTIME_PREFIX)
    ? rawId
    : `${CUSTOM_TOOL_RUNTIME_PREFIX}${rawId}`
}

export const resolveCustomToolEntityId = (runtimeId: string): string =>
  runtimeId.startsWith(CUSTOM_TOOL_RUNTIME_PREFIX)
    ? runtimeId.slice(CUSTOM_TOOL_RUNTIME_PREFIX.length)
    : runtimeId

export const CustomToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.any()),
  required: z.array(z.string()).optional(),
})

export const CustomToolFunctionSchema = z
  .object({
    description: z.string().optional(),
    parameters: CustomToolParametersSchema,
  })
  .strict()

export const CustomToolOpenAiSchema = z
  .object({
    type: z.literal('function'),
    function: CustomToolFunctionSchema,
  })
  .strict()

export const CustomToolTransferSchema = z
  .object({
    title: z
      .string()
      .transform(normalizeInlineWhitespace)
      .pipe(z.string().min(1, 'Tool title is required')),
    schema: CustomToolOpenAiSchema,
    code: z.string(),
  })
  .strict()

export const CustomToolUpsertRequestSchema = z.object({
  workspaceId: z
    .string({ required_error: 'workspaceId is required' })
    .min(1, 'workspaceId is required'),
  tools: z.array(
    z.object({
      id: z.string().optional(),
      title: z
        .string()
        .transform(normalizeInlineWhitespace)
        .pipe(z.string().min(1, 'Tool title is required')),
      schema: CustomToolOpenAiSchema,
      code: z.string(),
    })
  ),
})

export type CustomToolTransferRecord = z.infer<typeof CustomToolTransferSchema>

export function parseCustomToolSchemaValue(
  schemaValue: unknown
): z.infer<typeof CustomToolOpenAiSchema> {
  return CustomToolOpenAiSchema.parse(schemaValue)
}

export function parseCustomToolSchemaText(
  schemaText: unknown
): z.infer<typeof CustomToolOpenAiSchema> {
  if (typeof schemaText !== 'string') {
    throw new Error('custom tool schemaText is required')
  }

  return parseCustomToolSchemaValue(JSON.parse(schemaText))
}
