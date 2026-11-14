import type { TraceSpan } from './types'

/** Remove only server-owned span envelopes; intentional structured output keys remain business data. */
export function publicTraceSpans(spans: TraceSpan[]): TraceSpan[] {
  return spans.map((span) => {
    const { inference: _inference, ...visible } = span
    return { ...visible, ...(span.children ? { children: publicTraceSpans(span.children) } : {}) }
  })
}
