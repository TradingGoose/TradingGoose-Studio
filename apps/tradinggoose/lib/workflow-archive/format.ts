import { createHash } from 'node:crypto'

export type ArchiveScope = { workspaceId: string; executionId: string; logId: string }
export type ArchiveReference = ArchiveScope & {
  version: 1
  purpose: 'workflow-archive'
  provider: 'local' | 's3' | 'azure' | 'vercel'
  key: string
  digest: string
}

/** Type tags distinguish absent/undefined, dates and JSON values without ambiguous sentinels. */
export function encodeFunctionalValue(value: unknown): unknown {
  if (value === undefined) return ['undefined']
  if (value === null) return ['null']
  if (typeof value === 'string' || typeof value === 'boolean') return [typeof value, value]
  if (typeof value === 'number' && Number.isFinite(value))
    return ['number', Object.is(value, -0) ? '-0' : value]
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return ['date', value.toISOString()]
  if (Array.isArray(value)) return ['array', value.map(encodeFunctionalValue)]
  if (value instanceof Map)
    return [
      'map',
      [...value].map(([key, entry]) => [encodeFunctionalValue(key), encodeFunctionalValue(entry)]),
    ]
  if (value instanceof Set) return ['set', [...value].map(encodeFunctionalValue)]
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return [
      'object',
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, encodeFunctionalValue(entry)]),
    ]
  throw new Error('Unrepresentable functional archive value; preserve original source')
}

export function decodeFunctionalValue(value: unknown): any {
  if (!Array.isArray(value)) throw new Error('Malformed functional archive encoding')
  const [type, body] = value
  if (type !== 'undefined' && type !== 'null' && value.length !== 2)
    throw new Error('Malformed functional archive arity')
  if (type === 'undefined' && value.length === 1) return undefined
  if (type === 'null' && value.length === 1) return null
  if (
    (type === 'string' && typeof body === 'string') ||
    (type === 'boolean' && typeof body === 'boolean')
  )
    return body
  if (type === 'number' && ((typeof body === 'number' && Number.isFinite(body)) || body === '-0'))
    return body === '-0' ? -0 : body
  if (type === 'date' && typeof body === 'string' && Number.isFinite(Date.parse(body)))
    return new Date(body)
  if (['array', 'set', 'map', 'object'].includes(type) && Array.isArray(body)) {
    if (type === 'array') return body.map(decodeFunctionalValue)
    if (type === 'set') return new Set(body.map(decodeFunctionalValue))
    if (type === 'map')
      return new Map(
        body.map((entry) => {
          if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Malformed archive map')
          return [decodeFunctionalValue(entry[0]), decodeFunctionalValue(entry[1])]
        })
      )
    const result: Record<string, unknown> = {}
    for (const entry of body) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        Object.hasOwn(result, entry[0])
      )
        throw new Error('Malformed archive object')
      Object.defineProperty(result, entry[0], {
        value: decodeFunctionalValue(entry[1]),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return result
  }
  throw new Error('Malformed functional archive value')
}

export const functionalDigest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(encodeFunctionalValue(value)))
    .digest('hex')
export const byteDigest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
export function createArchiveBytes(scope: ArchiveScope, payload: unknown): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      purpose: 'workflow-archive',
      ...scope,
      payload: encodeFunctionalValue(payload),
    })
  )
}
export function readArchiveBytes(reference: ArchiveReference, bytes: Buffer): any {
  if (byteDigest(bytes) !== reference.digest) throw new Error('Workflow archive digest mismatch')
  const parsed = JSON.parse(bytes.toString('utf8'))
  if (
    parsed.version !== 1 ||
    parsed.purpose !== 'workflow-archive' ||
    ['workspaceId', 'executionId', 'logId'].some(
      (field) => parsed[field] !== reference[field as keyof ArchiveScope]
    )
  )
    throw new Error('Workflow archive scope mismatch')
  return decodeFunctionalValue(parsed.payload)
}
