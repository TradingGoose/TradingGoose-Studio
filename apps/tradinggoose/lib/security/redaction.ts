const REDACTED_VALUE = '[redacted]'
const TRUNCATED_VALUE = '[truncated]'

const SAFE_TOKEN_METRIC_KEYS = new Set([
  'completiontokencount',
  'completiontokens',
  'inputtokencount',
  'inputtokens',
  'outputtokencount',
  'outputtokens',
  'prompttokencount',
  'prompttokens',
  'tokencount',
  'tokens',
  'totaltokencount',
  'totaltokens',
])
const SAFE_TOKEN_METRIC_FIELDS = new Set([
  'cached',
  'completion',
  'input',
  'output',
  'prompt',
  'reasoning',
  'total',
])
const SECRET_KEY_PATTERN =
  /^(?:accountid|accountnumber|serviceid)$|accesskey|apikey|apisecret|authkey|cookie|credential|privatekey|secretkey|secret|password|passwd|authorization|token/
const SECRET_TEXT_PATTERN =
  /((?:["'])?(?:access[-_ ]?key|api[-_ ]?key|api[-_ ]?secret|auth[-_ ]?key|authorization|client[-_ ]?secret|cookie|credential|password|passwd|private[-_ ]?key|secret[-_ ]?key|secret|token)(?:["'])?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^,;&\r\n}]+)/giu
const AUTH_VALUE_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu
const URI_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]*:[^/@\s]+@/giu

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: false })
const byteLength = (value: string) => utf8Encoder.encode(value).byteLength

function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value
  const suffix = `…${TRUNCATED_VALUE}`
  const budget = Math.max(0, maxBytes - byteLength(suffix))
  const prefix = utf8Decoder.decode(utf8Encoder.encode(value).slice(0, budget)).replace(/�$/u, '')
  return `${prefix}${suffix}`
}

function redactSensitiveText(value: string): string {
  return value
    .replace(SECRET_TEXT_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(AUTH_VALUE_PATTERN, '$1 [redacted]')
    .replace(URI_CREDENTIAL_PATTERN, '$1[redacted]@')
}

function isTokenMetricValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length > 0 &&
    entries.every(
      ([key, entry]) =>
        SAFE_TOKEN_METRIC_FIELDS.has(key.replace(/[^a-z0-9]/giu, '').toLowerCase()) &&
        typeof entry === 'number' &&
        Number.isFinite(entry)
    )
  )
}

export function isSensitiveDataKey(key: string, value?: unknown): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  if (!SECRET_KEY_PATTERN.test(normalized)) return false
  return !SAFE_TOKEN_METRIC_KEYS.has(normalized) || !isTokenMetricValue(value)
}

export function deepRedactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (Array.isArray(value)) return value.map(deepRedactSecrets)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveDataKey(key, entry) ? REDACTED_VALUE : deepRedactSecrets(entry),
    ])
  )
}

export type RedactedJsonLimits = {
  maxArrayItems: number
  maxDepth: number
  maxNodes: number
  maxObjectEntries: number
  maxStringBytes: number
}

export function projectBoundedRedactedJson(
  value: unknown,
  limits: RedactedJsonLimits
): { value: unknown; truncated: boolean } {
  const state = { nodes: 0, seen: new WeakSet<object>(), truncated: false }

  const visit = (item: unknown, depth: number): unknown => {
    if (++state.nodes > limits.maxNodes) {
      state.truncated = true
      return TRUNCATED_VALUE
    }
    if (typeof item === 'string') {
      const redacted = redactSensitiveText(item)
      const result = truncateUtf8(redacted, limits.maxStringBytes)
      if (result !== redacted) state.truncated = true
      return result
    }
    if (typeof item === 'number') return Number.isFinite(item) ? item : null
    if (typeof item === 'bigint') return String(item)
    if (typeof item === 'boolean' || item === null) return item
    if (!item || typeof item !== 'object') return null
    if (item instanceof Date) return item.toISOString()
    if (depth >= limits.maxDepth || state.seen.has(item)) {
      state.truncated = true
      return TRUNCATED_VALUE
    }
    state.seen.add(item)

    if (Array.isArray(item)) {
      const result = item.slice(0, limits.maxArrayItems).map((entry) => visit(entry, depth + 1))
      if (item.length > limits.maxArrayItems) {
        state.truncated = true
        result.push(TRUNCATED_VALUE)
      }
      return result
    }

    const allEntries = Object.entries(item).sort(([left], [right]) => left.localeCompare(right))
    const entries = allEntries.slice(0, limits.maxObjectEntries)
    if (allEntries.length > entries.length) state.truncated = true
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        truncateUtf8(key, limits.maxStringBytes),
        isSensitiveDataKey(key, entry) ? REDACTED_VALUE : visit(entry, depth + 1),
      ])
    )
  }

  return { value: visit(value, 0), truncated: state.truncated }
}
