import { redactApiKeys } from '@/lib/utils'
import type { TraceSpan } from '@/stores/logs/filters/types'

export function getSpanKey(span: TraceSpan): string {
  if (span.id) {
    return span.id
  }

  const name = span.name || 'span'
  const start = span.startTime || 'unknown-start'
  const end = span.endTime || 'unknown-end'

  return `${name}|${start}|${end}`
}

export function mergeTraceSpanChildren(...groups: TraceSpan[][]): TraceSpan[] {
  const merged: TraceSpan[] = []
  const seen = new Set<string>()

  groups.forEach((group) => {
    group.forEach((child) => {
      const key = getSpanKey(child)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      merged.push(child)
    })
  })

  return merged
}

export function normalizeChildWorkflowSpan(span: TraceSpan): TraceSpan {
  const enrichedSpan: TraceSpan = { ...span }

  if (enrichedSpan.output && typeof enrichedSpan.output === 'object') {
    enrichedSpan.output = { ...enrichedSpan.output }
  }

  const normalizedChildren = Array.isArray(span.children)
    ? span.children.map((childSpan) => normalizeChildWorkflowSpan(childSpan))
    : []

  const outputChildSpans = Array.isArray(span.output?.childTraceSpans)
    ? (span.output!.childTraceSpans as TraceSpan[]).map((childSpan) =>
        normalizeChildWorkflowSpan(childSpan)
      )
    : []

  const mergedChildren = mergeTraceSpanChildren(normalizedChildren, outputChildSpans)

  if (enrichedSpan.output && 'childTraceSpans' in enrichedSpan.output) {
    const { childTraceSpans, ...cleanOutput } = enrichedSpan.output as {
      childTraceSpans?: TraceSpan[]
    } & Record<string, unknown>
    enrichedSpan.output = cleanOutput
  }

  enrichedSpan.children = mergedChildren.length > 0 ? mergedChildren : undefined

  return enrichedSpan
}

export function transformBlockData(data: unknown, _blockType: string, isInput: boolean) {
  if (data === null || data === undefined) return data

  if (isInput) {
    return redactApiKeys(data)
  }

  return data
}

export function formatDurationDisplay(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}
