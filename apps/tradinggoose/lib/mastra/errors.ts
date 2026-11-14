import { deepRedactSecrets } from '@/lib/security/redaction'
import { getInferenceFacts, withInferenceFacts } from './result'

/** Keep completed native work through HTTP/tool errors without copying SDK requests or credentials. */
export function getFailureAccounting(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {}
  const source = error as Record<string, unknown>
  const accounting: Record<string, unknown> = {}
  for (const key of ['model', 'tokens', 'cost', 'embeddingUsage']) {
    if (source[key] !== undefined) accounting[key] = source[key]
  }
  const redacted = deepRedactSecrets(accounting) as Record<string, unknown>
  const facts = getInferenceFacts(error)
  return facts ? withInferenceFacts(redacted, facts) : redacted
}

/** Only an internal inference producer can restore facts lost at its HTTP boundary. */
export function restoreInferenceError(error: Error): Error {
  if (getInferenceFacts(error)) return error
  const accounting = getFailureAccounting(error)
  if (!Object.keys(accounting).length) return error
  Object.assign(error, accounting)
  return withInferenceFacts(error, {
    ...accounting,
    generatedFields: Object.keys(accounting),
  })
}

export function safeInferenceError(error: unknown, apiKey?: string): string {
  let message =
    error instanceof Error
      ? error.message
      : 'Model request failed. Check the selected model and connection.'
  if (apiKey) message = message.replaceAll(apiKey, '[redacted]')
  return deepRedactSecrets(message) as string
}

export class WorkflowMemoryError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message)
  }
}
