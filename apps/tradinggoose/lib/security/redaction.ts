const REDACTED_VALUE = '[redacted]'
const CIRCULAR_VALUE = '[Circular]'
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
  /^(?:accountid|accountnumber|serviceid|sig|signature|xamzsignature|xgoogsignature)$|accesskey|apikey|apisecret|authkey|cookie|credential|passphrase|privatekey|secretkey|secret|password|passwd|authorization|token/
const SECRET_TEXT_PATTERN =
  /((?:["'])?(?:access[-_ ]?key|api[-_ ]?key|api[-_ ]?secret|auth[-_ ]?key|authorization|client[-_ ]?secret|cookie|credential|passphrase|password|passwd|private[-_ ]?key|secret[-_ ]?key|secret|token)(?:["'])?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^,;&\r\n}]+)/giu
const PRIVATE_KEY_PEM_PATTERN =
  /-----BEGIN ((?:[A-Z0-9]+[ -])*PRIVATE KEY)-----[\s\S]*?-----END \1-----/giu
const AUTH_VALUE_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu
const URI_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]*:[^/@\s]+@/giu
const SIGNED_URL_QUERY_PATTERN =
  /([?&](?:sig|signature|x-amz-signature|x-goog-signature)=)[^&#\s"'<>]+/giu
const SENSITIVE_VALUE_DISCRIMINATORS = ['Key', 'key', 'Name', 'name'] as const

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
    .replace(PRIVATE_KEY_PEM_PATTERN, REDACTED_VALUE)
    .replace(SECRET_TEXT_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(AUTH_VALUE_PATTERN, '$1 [redacted]')
    .replace(URI_CREDENTIAL_PATTERN, '$1[redacted]@')
    .replace(SIGNED_URL_QUERY_PATTERN, `$1${REDACTED_VALUE}`)
}

function isTokenMetricValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  let entryCount = 0
  const record = value as Record<string, unknown>
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue
    const entry = record[key]
    if (
      !SAFE_TOKEN_METRIC_FIELDS.has(key.replace(/[^a-z0-9]/giu, '').toLowerCase()) ||
      typeof entry !== 'number' ||
      !Number.isFinite(entry)
    )
      return false
    entryCount += 1
  }
  return entryCount > 0
}

export function isSensitiveDataKey(key: string, value?: unknown): boolean {
  const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase()
  if (!SECRET_KEY_PATTERN.test(normalized)) return false
  return !SAFE_TOKEN_METRIC_KEYS.has(normalized) || !isTokenMetricValue(value)
}

function isSensitiveDataEntry(
  record: Record<string, unknown>,
  key: string,
  value: unknown
): boolean {
  if (isSensitiveDataKey(key, value)) return true
  if (key.toLowerCase() !== 'value') return false
  return SENSITIVE_VALUE_DISCRIMINATORS.some((discriminator) => {
    const label = Object.hasOwn(record, discriminator) ? record[discriminator] : null
    return typeof label === 'string' && isSensitiveDataKey(label, value)
  })
}

function redactSecrets(value: unknown, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactSensitiveText(value)
  if (!value || typeof value !== 'object') return value
  if (value instanceof Error) {
    return { name: value.name, message: redactSensitiveText(value.message) }
  }
  if (value instanceof Date) return value.toISOString()
  const isArray = Array.isArray(value)
  if (ancestors.has(value)) return CIRCULAR_VALUE

  ancestors.add(value)
  const record = value as Record<string, unknown>
  const result = isArray
    ? value.map((entry) => redactSecrets(entry, ancestors))
    : Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          isSensitiveDataEntry(record, key, entry)
            ? REDACTED_VALUE
            : redactSecrets(entry, ancestors),
        ])
      )
  ancestors.delete(value)
  return result
}

export function deepRedactSecrets(value: unknown): unknown {
  return redactSecrets(value, new WeakSet())
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

    const record = item as Record<string, unknown>
    const result: Record<string, unknown> = {}
    let entryCount = 0
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue
      if (entryCount++ >= limits.maxObjectEntries) {
        state.truncated = true
        break
      }
      const entry = record[key]
      result[truncateUtf8(key, limits.maxStringBytes)] = isSensitiveDataEntry(record, key, entry)
        ? REDACTED_VALUE
        : visit(entry, depth + 1)
    }
    return result
  }

  return { value: visit(value, 0), truncated: state.truncated }
}

export function stringifyBoundedRedactedJson(value: unknown, limits: RedactedJsonLimits): string {
  const projected = projectBoundedRedactedJson(value, limits)
  const output =
    projected.truncated &&
    projected.value &&
    typeof projected.value === 'object' &&
    !Array.isArray(projected.value)
      ? { ...(projected.value as Record<string, unknown>), contextTruncated: true }
      : projected.value
  return JSON.stringify(output) ?? 'null'
}
