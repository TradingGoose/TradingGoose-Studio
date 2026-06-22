import { z } from 'zod'
import {
  type CustomToolTransferRecord as CustomToolTransferRecordType,
  CustomToolTransferSchema,
} from '@/lib/custom-tools/schema'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'

export type { CustomToolTransferRecord } from '@/lib/custom-tools/schema'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')

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
export type CustomToolsImportFile = z.infer<typeof CustomToolsImportFileSchema>

function normalizeToolForTransfer(
  tool: Pick<CustomToolDefinition, 'title' | 'schema' | 'code'>
): CustomToolTransferRecordType {
  return {
    title: normalizeInlineWhitespace(tool.title),
    schema: {
      type: 'function',
      function: {
        description: tool.schema.function.description,
        parameters: {
          type: 'object',
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
  return CustomToolsImportFileSchema.parse(
    createTradingGooseExportFile({
      exportedFrom,
      resourceTypes: ['customTools'],
      resources: {
        customTools: customTools.map(normalizeToolForTransfer),
      },
    })
  ) as CustomToolsImportFile
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
  if (!normalizedTitle) {
    throw new Error('Custom tool title is required')
  }

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

export function resolveImportedCustomTools({
  customTools,
  usedTitles,
}: {
  customTools: CustomToolTransferRecordType[]
  usedTitles: Iterable<string>
}) {
  const reservedTitles = new Set(Array.from(usedTitles))
  let renamedCount = 0

  const resolvedTools = customTools.map((tool) => {
    const resolvedTitle = resolveImportedCustomToolTitle(tool.title, reservedTitles)

    reservedTitles.add(resolvedTitle)

    if (resolvedTitle !== tool.title) {
      renamedCount += 1
    }

    return {
      ...tool,
      title: resolvedTitle,
    }
  })

  return {
    tools: resolvedTools,
    renamedCount,
  }
}
