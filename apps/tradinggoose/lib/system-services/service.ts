import { db } from '@tradinggoose/db'
import { systemServiceValue } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'
import {
  getSystemServiceDefinition,
  getSystemServiceDefinitions,
  type SystemServiceSettingFieldDefinition,
  isSystemServiceCredentialKey,
  isSystemServiceSettingKey,
} from './catalog'

const logger = createLogger('SystemServicesService')

type SystemServiceValueRecord = typeof systemServiceValue.$inferSelect
type SystemServiceResolvedValue = string | number | boolean
type SystemServiceValueKind = 'credential' | 'setting'

export interface SystemServiceCredentialInput {
  key: string
  value: string
  hasValue: boolean
}

export interface SystemServiceSettingInput {
  key: string
  value: string
  hasValue: boolean
}

export interface SystemServiceCredentialState {
  key: string
  hasValue: boolean
}

export interface SystemServiceSettingState {
  key: string
  hasValue: boolean
  storedValue: string
}

export interface SystemServiceState {
  id: string
  displayName: string
  description: string
  credentials: SystemServiceCredentialState[]
  settings: SystemServiceSettingState[]
}

export class SystemServiceValidationError extends Error {}

export async function listSystemServices(): Promise<SystemServiceState[]> {
  const rows = await db
    .select()
    .from(systemServiceValue)
    .orderBy(systemServiceValue.service, systemServiceValue.kind, systemServiceValue.key)

  const credentialKeys = new Set<string>()
  const settingValues = new Map<string, string>()

  for (const row of rows) {
    const compositeKey = `${row.service}:${row.key}`
    if (row.kind === 'credential') {
      credentialKeys.add(compositeKey)
      continue
    }
    settingValues.set(compositeKey, row.value)
  }

  return getSystemServiceDefinitions().map((definition) => ({
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
    credentials: definition.credentialFields.map((field) => ({
      key: field.key,
      hasValue: credentialKeys.has(`${definition.id}:${field.key}`),
    })),
    settings: definition.settingFields.map((field) => {
      const storedValue = settingValues.get(`${definition.id}:${field.key}`) ?? ''
      return {
        key: field.key,
        hasValue: storedValue.trim().length > 0,
        storedValue,
      }
    }),
  }))
}

async function resolveSystemServiceCredentials(serviceId: string): Promise<Record<string, string>> {
  const definition = getSystemServiceDefinition(serviceId)
  if (!definition) {
    throw new SystemServiceValidationError(`Unknown system service "${serviceId}"`)
  }

  const rows = await db
    .select()
    .from(systemServiceValue)
    .where(and(eq(systemServiceValue.service, serviceId), eq(systemServiceValue.kind, 'credential')))

  const resolvedEntries = await Promise.all(
    rows.map(async (row) => {
      const value = await decryptStoredCredential(row)
      return value ? ([row.key, value] as const) : null
    })
  )

  return Object.fromEntries(
    resolvedEntries.filter((entry): entry is readonly [string, string] => !!entry)
  )
}

async function resolveSystemServiceSettings(
  serviceId: string
): Promise<Record<string, SystemServiceResolvedValue>> {
  const definition = getSystemServiceDefinition(serviceId)
  if (!definition) {
    throw new SystemServiceValidationError(`Unknown system service "${serviceId}"`)
  }

  const rows = await db
    .select()
    .from(systemServiceValue)
    .where(and(eq(systemServiceValue.service, serviceId), eq(systemServiceValue.kind, 'setting')))

  const rowsByKey = new Map(rows.map((row) => [row.key, row.value]))

  return Object.fromEntries(
    definition.settingFields.flatMap((field) => {
      const storedValue = rowsByKey.get(field.key)
      if (storedValue !== undefined) {
        return [[field.key, parseSettingValue(field, storedValue)]]
      }

      if (field.defaultValue !== undefined) {
        return [[field.key, field.defaultValue]]
      }

      return []
    })
  )
}

export async function resolveSystemServiceConfig(
  serviceId: string
): Promise<Record<string, SystemServiceResolvedValue>> {
  const [credentials, settings] = await Promise.all([
    resolveSystemServiceCredentials(serviceId),
    resolveSystemServiceSettings(serviceId),
  ])

  return {
    ...settings,
    ...credentials,
  }
}

export async function upsertSystemServiceConfig(input: {
  serviceId: string
  credentials: SystemServiceCredentialInput[]
  settings: SystemServiceSettingInput[]
}) {
  const definition = getSystemServiceDefinition(input.serviceId)
  if (!definition) {
    throw new SystemServiceValidationError(`Unknown system service "${input.serviceId}"`)
  }

  const nextCredentials = normalizeCredentials(input.serviceId, input.credentials)
  const nextSettings = normalizeSettings(input.serviceId, input.settings)

  const existingRows = await db
    .select()
    .from(systemServiceValue)
    .where(eq(systemServiceValue.service, input.serviceId))

  const existingRowsByCompositeKey = new Map(
    existingRows.map((row) => [buildCompositeKey(row.kind, row.key), row])
  )

  const persistedCredentialRows = (
    await Promise.all(
      nextCredentials.map(async (credential) => {
        const trimmedValue = credential.value.trim()
        if (trimmedValue) {
          const { encrypted } = await encryptSecret(trimmedValue)
          return {
            id: buildRowId(input.serviceId, 'credential', credential.key),
            service: input.serviceId,
            kind: 'credential' as const,
            key: credential.key,
            value: encrypted,
            updatedAt: new Date(),
          }
        }

        if (credential.hasValue) {
          const existing = existingRowsByCompositeKey.get(buildCompositeKey('credential', credential.key))
          if (existing?.value?.trim()) {
            return {
              id: existing.id,
              service: existing.service,
              kind: existing.kind,
              key: existing.key,
              value: existing.value,
              updatedAt: new Date(),
            }
          }
        }

        return null
      })
    )
  ).filter((row): row is NonNullable<typeof row> => row !== null)

  const persistedSettingRows = nextSettings
    .map((setting) => {
      const normalizedValue = setting.value.trim()
      if (normalizedValue.length > 0) {
        return {
          id: buildRowId(input.serviceId, 'setting', setting.key),
          service: input.serviceId,
          kind: 'setting' as const,
          key: setting.key,
          value: normalizedValue,
          updatedAt: new Date(),
        }
      }

      if (setting.hasValue) {
        const existing = existingRowsByCompositeKey.get(buildCompositeKey('setting', setting.key))
        if (existing?.value?.trim()) {
          return {
            id: existing.id,
            service: existing.service,
            kind: existing.kind,
            key: existing.key,
            value: existing.value,
            updatedAt: new Date(),
          }
        }
      }

      return null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const persistedRows = [...persistedCredentialRows, ...persistedSettingRows]

  await db.transaction(async (tx) => {
    await tx.delete(systemServiceValue).where(eq(systemServiceValue.service, input.serviceId))

    if (persistedRows.length > 0) {
      await tx.insert(systemServiceValue).values(
        persistedRows.map((row) => ({
          id: row.id,
          service: row.service,
          kind: row.kind,
          key: row.key,
          value: row.value,
          createdAt:
            existingRowsByCompositeKey.get(buildCompositeKey(row.kind, row.key))?.createdAt ??
            new Date(),
          updatedAt: row.updatedAt,
        }))
      )
    }
  })
}

function buildCompositeKey(kind: SystemServiceValueKind, key: string) {
  return `${kind}:${key}`
}

function buildRowId(serviceId: string, kind: SystemServiceValueKind, key: string) {
  return `${serviceId}:${kind}:${key}`
}

function normalizeCredentials(serviceId: string, credentials: SystemServiceCredentialInput[]) {
  const seenKeys = new Set<string>()
  const normalized = credentials.map((credential) => {
    if (!isSystemServiceCredentialKey(serviceId, credential.key)) {
      throw new SystemServiceValidationError(
        `Unknown credential key "${credential.key}" for service "${serviceId}"`
      )
    }
    if (seenKeys.has(credential.key)) {
      throw new SystemServiceValidationError(
        `Duplicate credential key "${credential.key}" for service "${serviceId}"`
      )
    }
    seenKeys.add(credential.key)
    return {
      key: credential.key,
      value: credential.value,
      hasValue: credential.hasValue,
    }
  })

  const expectedKeys =
    getSystemServiceDefinition(serviceId)?.credentialFields.map((field) => field.key) ?? []
  if (normalized.length !== expectedKeys.length || expectedKeys.some((key) => !seenKeys.has(key))) {
    throw new SystemServiceValidationError(
      `Service "${serviceId}" must provide all credential fields in a single update`
    )
  }

  return normalized
}

function normalizeSettings(serviceId: string, settings: SystemServiceSettingInput[]) {
  const definition = getSystemServiceDefinition(serviceId)
  if (!definition) {
    throw new SystemServiceValidationError(`Unknown system service "${serviceId}"`)
  }

  const expectedFields = definition.settingFields
  const seenKeys = new Set<string>()

  const normalized = settings.map((setting) => {
    if (!isSystemServiceSettingKey(serviceId, setting.key)) {
      throw new SystemServiceValidationError(
        `Unknown setting key "${setting.key}" for service "${serviceId}"`
      )
    }

    if (seenKeys.has(setting.key)) {
      throw new SystemServiceValidationError(
        `Duplicate setting key "${setting.key}" for service "${serviceId}"`
      )
    }

    const field = expectedFields.find((item) => item.key === setting.key)
    if (!field) {
      throw new SystemServiceValidationError(
        `Unknown setting key "${setting.key}" for service "${serviceId}"`
      )
    }

    seenKeys.add(setting.key)
    return {
      key: setting.key,
      value: normalizeSettingInputValue(field, setting.value),
      hasValue: setting.hasValue,
    }
  })

  const expectedKeys = expectedFields.map((field) => field.key)
  if (normalized.length !== expectedKeys.length || expectedKeys.some((key) => !seenKeys.has(key))) {
    throw new SystemServiceValidationError(
      `Service "${serviceId}" must provide all setting fields in a single update`
    )
  }

  return normalized
}

function normalizeSettingInputValue(
  field: SystemServiceSettingFieldDefinition,
  rawValue: string
): string {
  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  switch (field.type) {
    case 'boolean': {
      if (value !== 'true' && value !== 'false') {
        throw new SystemServiceValidationError(
          `Setting "${field.key}" must be "true" or "false"`
        )
      }
      return value
    }
    case 'number': {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        throw new SystemServiceValidationError(`Setting "${field.key}" must be a valid number`)
      }
      return String(parsed)
    }
    case 'url': {
      try {
        new URL(value)
        return value
      } catch {
        throw new SystemServiceValidationError(`Setting "${field.key}" must be a valid URL`)
      }
    }
    case 'text':
    default:
      return value
  }
}

function parseSettingValue(
  field: SystemServiceSettingFieldDefinition,
  storedValue: string
): SystemServiceResolvedValue {
  switch (field.type) {
    case 'boolean':
      return storedValue === 'true'
    case 'number': {
      const parsed = Number(storedValue)
      return Number.isFinite(parsed) ? parsed : field.defaultValue ?? 0
    }
    case 'text':
    case 'url':
    default:
      return storedValue
  }
}

async function decryptStoredCredential(row: SystemServiceValueRecord) {
  try {
    const { decrypted } = await decryptSecret(row.value)
    const trimmed = decrypted.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (error) {
    logger.error('Failed to decrypt system service credential', {
      service: row.service,
      key: row.key,
      error,
    })
    return null
  }
}
