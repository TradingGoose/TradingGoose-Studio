import { SpanStatusCode, trace } from '@opentelemetry/api'

// Lazy-load tracer
let _tracer: ReturnType<typeof trace.getTracer> | null = null

function getTracer() {
  if (!_tracer) {
    _tracer = trace.getTracer('tradinggoose-ai-platform', '1.0.0')
  }
  return _tracer
}

/**
 * Track platform events (workflow creation, knowledge base operations, etc.)
 */
export function trackPlatformEvent(
  eventName: string,
  attributes: Record<string, string | number | boolean>
): void {
  try {
    const tracer = getTracer()
    const span = tracer.startSpan(eventName, {
      attributes: {
        ...attributes,
        'event.name': eventName,
        'event.timestamp': Date.now(),
      },
    })
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  } catch (error) {
    // Silently fail
  }
}
