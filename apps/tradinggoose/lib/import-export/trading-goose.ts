import { z } from 'zod'

export const TRADING_GOOSE_EXPORT_VERSION = '1'
export const TRADING_GOOSE_EXPORT_FILE_TYPE = 'tradingGooseExport'

const normalizeString = (value: string) => value.trim()

const ResourceTypeSchema = z
  .string()
  .transform(normalizeString)
  .pipe(z.string().min(1, 'resourceTypes must only contain non-empty strings'))

export const TradingGooseExportEnvelopeSchema = z
  .object({
    version: z.literal(TRADING_GOOSE_EXPORT_VERSION),
    fileType: z.literal(TRADING_GOOSE_EXPORT_FILE_TYPE),
    exportedAt: z.string().datetime(),
    exportedFrom: z
      .string()
      .transform(normalizeString)
      .pipe(z.string().min(1, 'exportedFrom is required')),
    resourceTypes: z
      .array(ResourceTypeSchema)
      .min(1, 'resourceTypes is required')
      .refine((value) => new Set(value).size === value.length, {
        message: 'resourceTypes must not contain duplicates',
      }),
  })
  .passthrough()

export type TradingGooseExportEnvelope = z.infer<typeof TradingGooseExportEnvelopeSchema>

type TradingGooseExportResources = {
  skills: unknown[]
  workflows: unknown[]
  customTools: unknown[]
  watchlists: unknown[]
  indicators: unknown[]
}

type CreateTradingGooseExportFileParams<TResources extends Partial<TradingGooseExportResources>> = {
  exportedFrom: string
  resourceTypes: string[]
  resources: TResources
}

const omitUndefinedEntries = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry !== 'undefined')) as T

const createDefaultTradingGooseExportResources = (): TradingGooseExportResources => ({
  skills: [],
  workflows: [],
  customTools: [],
  watchlists: [],
  indicators: [],
})

export function createTradingGooseExportFile<
  TResources extends Partial<TradingGooseExportResources>,
>({
  exportedFrom,
  resourceTypes,
  resources,
}: CreateTradingGooseExportFileParams<TResources>): TradingGooseExportEnvelope &
  TradingGooseExportResources &
  TResources {
  return {
    version: TRADING_GOOSE_EXPORT_VERSION,
    fileType: TRADING_GOOSE_EXPORT_FILE_TYPE,
    exportedAt: new Date().toISOString(),
    exportedFrom: normalizeString(exportedFrom),
    resourceTypes: resourceTypes.map(normalizeString),
    ...createDefaultTradingGooseExportResources(),
    ...omitUndefinedEntries(resources),
  }
}
