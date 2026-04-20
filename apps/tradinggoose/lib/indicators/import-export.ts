import { z } from 'zod'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { IndicatorDefinition } from '@/stores/indicators/types'

const IMPORTED_INDICATOR_MARKER = '(imported)'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const normalizeOptionalString = (value: string | null | undefined) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

export const IndicatorTransferSchema = z
  .object({
    name: z
      .string()
      .transform(normalizeInlineWhitespace)
      .pipe(z.string().min(1, 'Indicator name is required')),
    color: z.string().transform(normalizeInlineWhitespace).optional(),
    pineCode: z.string(),
    inputMeta: z.record(z.any()).optional(),
  })
  .strict()

export const IndicatorsTransferListSchema = z
  .array(IndicatorTransferSchema)
  .min(1, 'At least one indicator is required')

export const IndicatorsImportFileSchema = TradingGooseExportEnvelopeSchema.extend({
  indicators: IndicatorsTransferListSchema,
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('indicators')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include indicators',
      path: ['resourceTypes'],
    })
  }
})

export type IndicatorTransferRecord = z.infer<typeof IndicatorTransferSchema>
export type IndicatorsImportFile = z.infer<typeof IndicatorsImportFileSchema>

function normalizeIndicatorForTransfer(
  indicator: Pick<IndicatorDefinition, 'name' | 'color' | 'pineCode' | 'inputMeta'>
): IndicatorTransferRecord {
  return {
    name: normalizeInlineWhitespace(indicator.name),
    color: normalizeOptionalString(indicator.color),
    pineCode: indicator.pineCode ?? '',
    inputMeta:
      indicator.inputMeta && typeof indicator.inputMeta === 'object'
        ? indicator.inputMeta
        : undefined,
  }
}

export function parseImportedIndicatorsFile(input: unknown): IndicatorsImportFile {
  return IndicatorsImportFileSchema.parse(input) as IndicatorsImportFile
}

export function createIndicatorsExportFile({
  indicators,
  exportedFrom,
}: {
  indicators: Array<Pick<IndicatorDefinition, 'name' | 'color' | 'pineCode' | 'inputMeta'>>
  exportedFrom: string
}): IndicatorsImportFile {
  return createTradingGooseExportFile({
    exportedFrom,
    resourceTypes: ['indicators'],
    resources: {
      indicators: indicators.map(normalizeIndicatorForTransfer),
    },
  }) as IndicatorsImportFile
}

export function exportIndicatorsAsJson({
  indicators,
  exportedFrom,
}: {
  indicators: Array<Pick<IndicatorDefinition, 'name' | 'color' | 'pineCode' | 'inputMeta'>>
  exportedFrom: string
}): string {
  return JSON.stringify(createIndicatorsExportFile({ indicators, exportedFrom }), null, 2)
}

function buildImportedIndicatorName(name: string, number: number) {
  return `${normalizeInlineWhitespace(name)} ${IMPORTED_INDICATOR_MARKER} ${number}`
}

export function resolveImportedIndicatorName(name: string, usedNames: Iterable<string>): string {
  const normalizedName = normalizeInlineWhitespace(name)
  const usedNamesSet = new Set(Array.from(usedNames))

  if (!usedNamesSet.has(normalizedName)) {
    return normalizedName
  }

  let nextNumber = 1
  let candidate = buildImportedIndicatorName(normalizedName, nextNumber)

  while (usedNamesSet.has(candidate)) {
    nextNumber += 1
    candidate = buildImportedIndicatorName(normalizedName, nextNumber)
  }

  return candidate
}
