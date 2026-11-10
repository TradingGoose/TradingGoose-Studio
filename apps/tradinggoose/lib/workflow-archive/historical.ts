import type { TraceSpan } from '@/lib/logs/types'
import { functionalDigest } from './format'
import { projectFunctionalBlocks } from './functional'

// These fields were assigned by the pre-cutover Agent handler after structured output.
// This offline conversion never infers report ownership from arbitrary nested key names.
const AGENT_REPORT_FIELDS = new Set(['tokens', 'cost', 'providerTiming'])
const AGENT_OVERWRITTEN_FIELDS = new Set([...AGENT_REPORT_FIELDS, 'toolCalls', 'toolResults'])

function assertHistoricalSchema(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Historical resolved Agent input is unavailable; keep source pinned')
  const format = (input as any).responseFormat
  if (format == null || format === '' || (typeof format === 'string' && !format.trim())) return
  let parsed: any
  try {
    parsed = typeof format === 'string' ? JSON.parse(format) : format
  } catch {
    throw new Error('Historical resolved response format is malformed; keep source pinned')
  }
  if (!parsed?.schema || typeof parsed.schema !== 'object' || Array.isArray(parsed.schema))
    throw new Error('Historical resolved response schema is unavailable; keep source pinned')
  const properties = parsed.schema.properties
  if (
    properties &&
    typeof properties === 'object' &&
    Object.keys(properties).some((key) => AGENT_OVERWRITTEN_FIELDS.has(key))
  )
    throw new Error('Historical structured fields were overwritten by reports; keep source pinned')
  // A union/reference can hide root properties; the old resolved schema cannot prove their absence.
  if (['$ref', 'allOf', 'anyOf', 'oneOf'].some((key) => Object.hasOwn(parsed.schema, key)))
    throw new Error('Historical response schema requires classification; keep source pinned')
}

/** One offline, exact source projection. No old-format runtime reader or fabricated native turns. */
export function projectHistoricalFunctionalPayload(spans: TraceSpan[], finalOutput: unknown) {
  const replacements = new Map<string, unknown>()
  const visit = (entries: TraceSpan[]): TraceSpan[] =>
    entries.map((span) => {
      let output = span.output
      if (span.blockId && span.type === 'agent') {
        assertHistoricalSchema(span.input)
        if (output && typeof output === 'object' && !Array.isArray(output)) {
          output = Object.fromEntries(
            Object.entries(output).filter(([key]) => !AGENT_REPORT_FIELDS.has(key))
          )
          replacements.set(functionalDigest(span.output), output)
        }
      }
      return {
        ...span,
        output,
        ...(span.children ? { children: visit(span.children) } : {}),
      }
    })
  const projected = visit(spans)
  // Only an exact complete retained Agent output establishes generated-field ownership here.
  const replaceOutput = (value: any): any => {
    if (!value || typeof value !== 'object') return value
    const key = functionalDigest(value)
    if (replacements.has(key)) return replacements.get(key)
    if (Array.isArray(value)) return value.map(replaceOutput)
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, replaceOutput(entry)])
    )
  }
  return { blocks: projectFunctionalBlocks(projected), output: replaceOutput(finalOutput) }
}
