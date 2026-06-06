import { z } from 'zod'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const normalizeFunctionName = (value: string) => value.trim()

export const CustomToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.any()),
  required: z.array(z.string()).optional(),
})

export const CustomToolFunctionSchema = z.object({
  name: z
    .string()
    .transform(normalizeFunctionName)
    .pipe(z.string().min(1, 'Function name is required')),
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

export const CustomToolUpsertRequestSchema = z.object({
  workspaceId: z
    .string({ required_error: 'workspaceId is required' })
    .min(1, 'workspaceId is required'),
  tools: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string().min(1, 'Tool title is required'),
      schema: CustomToolOpenAiSchema,
      code: z.string(),
    })
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
