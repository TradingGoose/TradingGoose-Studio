const parseEmbeddedJson = (text: string): unknown | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

const formatCodeMessage = (code?: string | null, message?: string | null) => {
  const trimmedCode = code?.trim()
  const trimmedMessage = message?.trim()
  if (!trimmedCode && !trimmedMessage) return null
  if (!trimmedCode) return trimmedMessage ?? null
  if (!trimmedMessage) return trimmedCode
  if (trimmedMessage.toLowerCase().includes(trimmedCode.toLowerCase())) {
    return trimmedMessage
  }
  return `${trimmedCode}: ${trimmedMessage}`
}

const extractMessage = (value: unknown): string | null => {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const embedded = parseEmbeddedJson(trimmed)
    if (embedded) {
      const extracted = extractMessage(embedded)
      if (extracted) return extracted
    }
    const providerPrefix = trimmed.toLowerCase().startsWith('provider error:')
    return providerPrefix ? trimmed.replace(/^provider error:\s*/i, '') : trimmed
  }
  if (typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const fromDescription = typeof record.description === 'string' ? record.description : null
  const fromMessage = typeof record.message === 'string' ? record.message : null
  const fromCode = typeof record.code === 'string' ? record.code : null

  const candidates = [fromDescription, fromMessage].filter(
    (candidate): candidate is string => typeof candidate === 'string'
  )
  for (const candidate of candidates) {
    const embedded = parseEmbeddedJson(candidate)
    if (embedded) {
      const extracted = extractMessage(embedded)
      if (extracted) return extracted
    }
    const providerPrefix = candidate.toLowerCase().startsWith('provider error:')
    const normalizedCandidate = providerPrefix
      ? candidate.replace(/^provider error:\s*/i, '')
      : candidate
    const normalizedEmbedded = parseEmbeddedJson(normalizedCandidate)
    if (normalizedEmbedded) {
      const extracted = extractMessage(normalizedEmbedded)
      if (extracted) return extracted
    }
  }

  const formatted = formatCodeMessage(fromCode, fromDescription ?? fromMessage)
  if (formatted) return formatted

  if (record.error) {
    const nested = extractMessage(record.error)
    if (nested) return nested
  }

  if (record.chart && typeof record.chart === 'object') {
    const chartMessage = extractMessage(record.chart)
    if (chartMessage) return chartMessage
  }

  if (record.details) {
    const detailsMessage = extractMessage(record.details)
    if (detailsMessage) return detailsMessage
  }

  return null
}

export const resolveProviderErrorMessage = (payload: any, fallback: string) => {
  const extracted = extractMessage(payload?.error) ?? extractMessage(payload)
  return extracted ?? fallback
}
