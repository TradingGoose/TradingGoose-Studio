import { z } from 'zod'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const normalizeFunctionName = (value: string) => value.trim()

const CustomToolFunctionParametersSchema = z.object({
  type: z.string(),
  properties: z.record(z.any()),
  required: z.array(z.string()).optional(),
})

const CustomToolFunctionSchema = z.object({
  name: z
    .string()
    .transform(normalizeFunctionName)
    .pipe(z.string().min(1, 'Function name is required')),
  description: z.string().optional(),
  parameters: CustomToolFunctionParametersSchema,
})

export const CustomToolTransferSchema = z
  .object({
    title: z
      .string()
      .transform(normalizeInlineWhitespace)
      .pipe(z.string().min(1, 'Tool title is required')),
    schema: z.object({
      type: z.literal('function'),
      function: CustomToolFunctionSchema,
    }),
    code: z.string(),
  })
  .strict()

export const CustomToolsTransferListSchema = z
  .array(CustomToolTransferSchema)
  .min(1, 'At least one custom tool is required')

export const CustomToolsImportFileSchema = TradingGooseExportEnvelopeSchema.extend({
  customTools: CustomToolsTransferListSchema,
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('customTools')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include customTools',
      path: ['resourceTypes'],
    })
  }
})

export type CustomToolTransferRecord = z.infer<typeof CustomToolTransferSchema>
export type CustomToolsImportFile = z.infer<typeof CustomToolsImportFileSchema>

function normalizeToolForTransfer(
  tool: Pick<CustomToolDefinition, 'title' | 'schema' | 'code'>
): CustomToolTransferRecord {
  return {
    title: normalizeInlineWhitespace(tool.title),
    schema: {
      type: 'function',
      function: {
        name: normalizeFunctionName(tool.schema.function.name),
        description: tool.schema.function.description,
        parameters: {
          type: tool.schema.function.parameters.type,
          properties: tool.schema.function.parameters.properties,
          required: tool.schema.function.parameters.required,
        },
      },
    },
    code: tool.code,
  }
}

export function parseImportedCustomToolsFile(input: unknown): CustomToolsImportFile {
  return CustomToolsImportFileSchema.parse(input) as CustomToolsImportFile
}

export function createCustomToolsExportFile({
  customTools,
  exportedFrom,
}: {
  customTools: Array<Pick<CustomToolDefinition, 'title' | 'schema' | 'code'>>
  exportedFrom: string
}): CustomToolsImportFile {
  return createTradingGooseExportFile({
    exportedFrom,
    resourceTypes: ['customTools'],
    resources: {
      customTools: customTools.map(normalizeToolForTransfer),
    },
  }) as CustomToolsImportFile
}

export function exportCustomToolsAsJson({
  customTools,
  exportedFrom,
}: {
  customTools: Array<Pick<CustomToolDefinition, 'title' | 'schema' | 'code'>>
  exportedFrom: string
}): string {
  return JSON.stringify(createCustomToolsExportFile({ customTools, exportedFrom }), null, 2)
}

export function resolveImportedCustomToolTitle(
  title: string,
  usedTitles: Iterable<string>
): string {
  const normalizedTitle = normalizeInlineWhitespace(title)
  const usedTitlesSet = new Set(Array.from(usedTitles))

  if (!usedTitlesSet.has(normalizedTitle)) {
    return normalizedTitle
  }

  let nextNumber = 1
  let candidate = `${normalizedTitle} (imported) ${nextNumber}`

  while (usedTitlesSet.has(candidate)) {
    nextNumber += 1
    candidate = `${normalizedTitle} (imported) ${nextNumber}`
  }

  return candidate
}

export function resolveImportedCustomToolFunctionName(
  functionName: string,
  usedFunctionNames: Iterable<string>
): string {
  const normalizedName = normalizeFunctionName(functionName)
  const usedFunctionNamesSet = new Set(Array.from(usedFunctionNames))

  if (!usedFunctionNamesSet.has(normalizedName)) {
    return normalizedName
  }

  let nextNumber = 1
  let candidate = `${normalizedName}_imported_${nextNumber}`

  while (usedFunctionNamesSet.has(candidate)) {
    nextNumber += 1
    candidate = `${normalizedName}_imported_${nextNumber}`
  }

  return candidate
}

export function resolveImportedCustomTools({
  customTools,
  usedTitles,
  usedFunctionNames,
}: {
  customTools: CustomToolTransferRecord[]
  usedTitles: Iterable<string>
  usedFunctionNames: Iterable<string>
}) {
  const reservedTitles = new Set(Array.from(usedTitles))
  const reservedFunctionNames = new Set(Array.from(usedFunctionNames))
  let renamedCount = 0

  const resolvedTools = customTools.map((tool) => {
    const resolvedTitle = resolveImportedCustomToolTitle(tool.title, reservedTitles)
    const resolvedFunctionName = resolveImportedCustomToolFunctionName(
      tool.schema.function.name,
      reservedFunctionNames
    )

    reservedTitles.add(resolvedTitle)
    reservedFunctionNames.add(resolvedFunctionName)

    if (resolvedTitle !== tool.title || resolvedFunctionName !== tool.schema.function.name) {
      renamedCount += 1
    }

    return {
      ...tool,
      title: resolvedTitle,
      schema: {
        ...tool.schema,
        function: {
          ...tool.schema.function,
          name: resolvedFunctionName,
        },
      },
    }
  })

  return {
    tools: resolvedTools,
    renamedCount,
  }
}
