import { z } from 'zod'

export const CUSTOM_TOOL_RUNTIME_ID_PREFIX = 'custom_'
const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const normalizeOptionalInlineWhitespace = (value: unknown) =>
  typeof value === 'string' ? normalizeInlineWhitespace(value) : ''

export function createCustomToolRuntimeId(entityId: string): string {
  const normalizedEntityId = entityId.trim()
  if (!normalizedEntityId) throw new Error('Custom tool entity id is required')
  return `${CUSTOM_TOOL_RUNTIME_ID_PREFIX}${normalizedEntityId}`
}

export const isCustomToolRuntimeId = (toolId: string | null | undefined): toolId is string =>
  typeof toolId === 'string' && toolId.startsWith(CUSTOM_TOOL_RUNTIME_ID_PREFIX)

export function getCustomToolEntityIdFromRuntimeId(runtimeId: string | null | undefined): string {
  if (
    typeof runtimeId !== 'string' ||
    runtimeId !== runtimeId.trim() ||
    !isCustomToolRuntimeId(runtimeId)
  ) {
    throw new Error('Custom tool runtime id is required')
  }

  const entityId = runtimeId.slice(CUSTOM_TOOL_RUNTIME_ID_PREFIX.length)
  if (!entityId) throw new Error('Custom tool entity id is required')
  return entityId
}

export function buildCustomToolModelDescription({
  title,
  description,
}: {
  title?: string | null
  description?: string | null
}): string {
  const normalizedTitle = normalizeOptionalInlineWhitespace(title)
  return [
    normalizedTitle ? `Custom tool title: ${normalizedTitle}` : '',
    normalizeOptionalInlineWhitespace(description),
  ]
    .filter(Boolean)
    .join('. ')
}

export const CustomToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.any()),
  required: z.array(z.string()).optional(),
})

export const CustomToolFunctionSchema = z.object({
  description: z.string().optional(),
  parameters: CustomToolParametersSchema,
})

export const CustomToolOpenAiSchema = z.object({
  type: z.literal('function'),
  function: CustomToolFunctionSchema,
})

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

export const CustomToolCreateRequestSchema = z.object({
  workspaceId: z
    .string({ error: 'workspaceId is required' })
    .min(1, 'workspaceId is required'),
  tools: z.array(
    z
      .object({
        title: z
          .string()
          .transform(normalizeInlineWhitespace)
          .pipe(z.string().min(1, 'Tool title is required')),
        schema: CustomToolOpenAiSchema,
        code: z.string(),
      })
      .strict()
  ),
})

export type CustomToolTransferRecord = z.infer<typeof CustomToolTransferSchema>

export function parseCustomToolSchemaText(
  schemaText: unknown
): z.infer<typeof CustomToolOpenAiSchema> {
  if (typeof schemaText !== 'string') {
    throw new Error('custom tool schemaText is required')
  }

  return CustomToolOpenAiSchema.parse(JSON.parse(schemaText))
}
