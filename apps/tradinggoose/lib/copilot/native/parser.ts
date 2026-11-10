import { type StandardSchemaWithJSON, toStandardSchema } from '@mastra/core/schema'
import { monetary } from '@tradinggoose/billing/money'
import { nativeSchema } from './schema.generated'

type SemanticSlots = Record<'FinancialFact' | 'ImagePart', readonly (readonly string[])[]>

function valuesAt(value: unknown, path: readonly string[]): unknown[] {
  if (!path.length) return value === undefined ? [] : [value]
  const [key, ...rest] = path
  if (key === '*') return Array.isArray(value) ? value.flatMap((item) => valuesAt(item, rest)) : []
  if (!value || typeof value !== 'object') return []
  return valuesAt((value as Record<string, unknown>)[key!], rest)
}

function validateSemantics(name: string, value: unknown, slots: SemanticSlots) {
  for (const path of slots.FinancialFact) {
    for (const fact of valuesAt(value, path)) {
      const amount = (fact as { appliedUsd?: unknown }).appliedUsd
      try {
        if (typeof amount !== 'string' || monetary(amount) !== amount) throw new Error()
      } catch {
        throw new Error(`Invalid native ${name}: accepted money must be a canonical decimal string`)
      }
    }
  }
  for (const path of slots.ImagePart) {
    for (const part of valuesAt(value, path)) {
      if (!part || typeof part !== 'object' || (part as { type?: unknown }).type !== 'image')
        continue
      const { image, mediaType } = part as { image: string; mediaType: string }
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
      try {
        if (
          !/^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType) ||
          !match ||
          match[1] !== mediaType ||
          btoa(atob(match[2]!)) !== match[2]
        )
          throw new Error()
      } catch {
        throw new Error(
          `Invalid native ${name}: image content must be verified inline base64 media`
        )
      }
    }
  }
}

/** Generated bindings connect each canonical definition to its generated output type. */
export function createNativeParser<T>(name: string, slots: SemanticSlots) {
  let validator: StandardSchemaWithJSON<T> | undefined
  return async (value: unknown): Promise<T> => {
    validator ??= toStandardSchema<T>({ ...nativeSchema, $ref: `#/definitions/${name}` })
    const result = await validator['~standard'].validate(value)
    if (result.issues) {
      throw new Error(
        `Invalid native ${name}: ${result.issues.map((issue) => issue.message).join('; ')}`
      )
    }
    validateSemantics(name, result.value, slots)
    return result.value
  }
}
