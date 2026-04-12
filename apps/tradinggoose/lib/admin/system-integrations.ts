import { db } from '@tradinggoose/db'
import { systemIntegrationDefinition, systemIntegrationSecret } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { encryptSecret } from '@/lib/utils'
import {
  getSystemIntegrationCatalogDefinitionIds,
  getSystemIntegrationCatalogSeedSnapshot,
} from '@/lib/system-integrations/catalog'

const nullableIdSchema = z
  .union([z.string().trim().min(1), z.null()])
  .optional()
  .transform((value) => value ?? null)

const nullableBooleanSchema = z.union([z.boolean(), z.null()])

export const systemIntegrationDefinitionSchema = z.object({
  id: z.string().trim().min(1),
  parentId: nullableIdSchema,
  name: z.string().trim().min(1),
  isEnabled: nullableBooleanSchema,
})

export const systemIntegrationSecretSchema = z.object({
  id: z.string().trim().min(1),
  definitionId: z.string().trim().min(1),
  key: z.string().trim().min(1),
  value: z.string(),
  hasValue: z.boolean(),
})

export const updateSystemIntegrationBundleSchema = z.object({
  definition: systemIntegrationDefinitionSchema,
  services: z.array(systemIntegrationDefinitionSchema),
  secrets: z.array(systemIntegrationSecretSchema),
})

export type SystemIntegrationDefinitionInput = z.infer<typeof systemIntegrationDefinitionSchema>
export type SystemIntegrationSecretInput = z.infer<typeof systemIntegrationSecretSchema>
export type UpdateSystemIntegrationBundleInput = z.infer<typeof updateSystemIntegrationBundleSchema>

export interface SystemIntegrationState {
  definitions: SystemIntegrationDefinitionInput[]
  secrets: SystemIntegrationSecretInput[]
}

export class SystemIntegrationValidationError extends Error {}

type PersistedSystemIntegrationSecret = {
  id: string
  definitionId: string
  key: string
  value: string
}

export async function listSystemIntegrations(): Promise<SystemIntegrationState> {
  const catalog = getSystemIntegrationCatalogSeedSnapshot()
  const catalogDefinitionIds = new Set(catalog.definitions.map((definition) => definition.id))
  const [allDefinitions, allSecrets] = await Promise.all([
    db
      .select()
      .from(systemIntegrationDefinition)
      .orderBy(systemIntegrationDefinition.createdAt, systemIntegrationDefinition.id),
    db
      .select()
      .from(systemIntegrationSecret)
      .orderBy(systemIntegrationSecret.createdAt, systemIntegrationSecret.id),
  ])

  const persistedDefinitions = allDefinitions.filter((definition) =>
    catalogDefinitionIds.has(definition.id)
  )
  const persistedSecrets = allSecrets.filter((secret) =>
    catalogDefinitionIds.has(secret.definitionId)
  )
  const persistedDefinitionsById = new Map(
    persistedDefinitions.map((definition) => [definition.id, definition])
  )
  const catalogDefinitions = catalog.definitions.map((definition) => {
    const persistedDefinition = persistedDefinitionsById.get(definition.id)

    return {
      id: definition.id,
      parentId: persistedDefinition?.parentId ?? definition.parentId,
      name: persistedDefinition?.name ?? definition.name,
      isEnabled: definition.parentId
        ? (persistedDefinition?.isEnabled ?? definition.isEnabled)
        : null,
    }
  })
  const sortedDefinitions = sortDefinitionsForInsert(catalogDefinitions)
  const persistedSecretsByKey = new Map(
    persistedSecrets.map((secret) => [`${secret.definitionId}:${secret.key}`, secret])
  )
  const normalizedSecrets = [
    ...catalog.secrets.map((secret) => {
      const persistedSecret = persistedSecretsByKey.get(`${secret.definitionId}:${secret.key}`)

      return {
        id: secret.id,
        definitionId: secret.definitionId,
        key: secret.key,
        value: '',
        hasValue: Boolean(persistedSecret?.value?.trim()),
      }
    }),
  ].sort(
    (left, right) =>
      left.definitionId.localeCompare(right.definitionId) ||
      left.key.localeCompare(right.key) ||
      left.id.localeCompare(right.id)
  )

  const normalizedDefinitions = normalizeDefinitionsForCredentialState(
    sortedDefinitions.map((definition) => ({
      id: definition.id,
      parentId: definition.parentId,
      name: definition.name,
      isEnabled: definition.isEnabled,
    })),
    normalizedSecrets
  )

  return {
    definitions: normalizedDefinitions,
    secrets: normalizedSecrets,
  }
}

export async function updateSystemIntegrationBundle(input: UpdateSystemIntegrationBundleInput) {
  validateSystemIntegrationBundlePayload(input)

  const definitions = sortDefinitionsForInsert(
    normalizeDefinitionsForCredentialState([input.definition, ...input.services], input.secrets)
  )
  const existingSecrets = await db
    .select()
    .from(systemIntegrationSecret)
    .where(eq(systemIntegrationSecret.definitionId, input.definition.id))
  const existingSecretsByKey = new Map(
    existingSecrets.map((secret) => [`${secret.definitionId}:${secret.key}`, secret])
  )
  const nextSecrets = (
    await Promise.all(
      input.secrets.map(async (secret) => {
        const nextValue = secret.value.trim()
        if (!secret.key.trim()) {
          return null
        }

        if (nextValue) {
          const { encrypted } = await encryptSecret(nextValue)
          return {
            id: secret.id,
            definitionId: secret.definitionId,
            key: secret.key,
            value: encrypted,
          }
        }

        const existingSecret = existingSecretsByKey.get(`${secret.definitionId}:${secret.key}`)
        if (secret.hasValue && existingSecret?.value?.trim()) {
          return {
            id: secret.id,
            definitionId: secret.definitionId,
            key: secret.key,
            value: existingSecret.value,
          }
        }

        return null
      })
    )
  ).filter((secret): secret is PersistedSystemIntegrationSecret => secret !== null)

  await db.transaction(async (tx) => {
    await tx
      .delete(systemIntegrationDefinition)
      .where(eq(systemIntegrationDefinition.id, input.definition.id))

    if (definitions.length > 0) {
      await tx.insert(systemIntegrationDefinition).values(
        definitions.map((definition) => ({
          id: definition.id,
          parentId: definition.parentId,
          name: definition.name,
          isEnabled: definition.isEnabled,
        }))
      )
    }

    if (nextSecrets.length > 0) {
      await tx.insert(systemIntegrationSecret).values(nextSecrets)
    }
  })
}

function validateSystemIntegrationBundlePayload(input: UpdateSystemIntegrationBundleInput) {
  const catalog = getSystemIntegrationCatalogSeedSnapshot()
  const catalogDefinitionIds = getSystemIntegrationCatalogDefinitionIds()
  const catalogDefinitionsById = new Map(
    catalog.definitions.map((definition) => [definition.id, definition])
  )
  const catalogSecretsByPair = new Map(
    catalog.secrets.map((secret) => [`${secret.definitionId}:${secret.key}`, secret])
  )
  const definitions = [input.definition, ...input.services]
  const definitionIds = new Set<string>()
  const secretIds = new Set<string>()
  const secretPairs = new Set<string>()
  const definitionsById = new Map<string, SystemIntegrationDefinitionInput>()

  const bundleCatalogDefinition = catalogDefinitionsById.get(input.definition.id)
  if (!bundleCatalogDefinition || bundleCatalogDefinition.parentId !== null) {
    throw new SystemIntegrationValidationError(
      `Integration definition ${input.definition.id} is not a root integration bundle`
    )
  }

  if (input.definition.parentId) {
    throw new SystemIntegrationValidationError(
      `Integration bundle ${input.definition.id} cannot reference a parent definition`
    )
  }
  if (input.definition.isEnabled !== null) {
    throw new SystemIntegrationValidationError(
      `Integration bundle ${input.definition.id} cannot define service availability`
    )
  }

  for (const service of input.services) {
    if (service.parentId !== input.definition.id) {
      throw new SystemIntegrationValidationError(
        `Service ${service.id} must reference parent bundle ${input.definition.id}`
      )
    }

    const catalogServiceDefinition = catalogDefinitionsById.get(service.id)
    if (!catalogServiceDefinition || catalogServiceDefinition.parentId !== input.definition.id) {
      throw new SystemIntegrationValidationError(
        `Service ${service.id} is not managed under bundle ${input.definition.id}`
      )
    }
    if (service.isEnabled === null) {
      throw new SystemIntegrationValidationError(
        `Service ${service.id} must define availability explicitly`
      )
    }
  }

  for (const secret of input.secrets) {
    if (secret.definitionId !== input.definition.id) {
      throw new SystemIntegrationValidationError(
        `Integration secret ${secret.id} must reference bundle ${input.definition.id}`
      )
    }
  }

  for (const definition of definitions) {
    ensureUnique(
      definitionIds,
      definition.id,
      `Duplicate integration definition id: ${definition.id}`
    )
    definitionsById.set(definition.id, definition)

    if (!catalogDefinitionIds.has(definition.id)) {
      throw new SystemIntegrationValidationError(
        `Integration definition ${definition.id} is not managed by the system integration catalog`
      )
    }
  }

  for (const definition of definitions) {
    if (definition.parentId && !definitionsById.has(definition.parentId)) {
      throw new SystemIntegrationValidationError(
        `Integration definition ${definition.id} references unknown parent ${definition.parentId}`
      )
    }
  }

  for (const secret of input.secrets) {
    ensureUnique(secretIds, secret.id, `Duplicate integration secret id: ${secret.id}`)
    ensureUnique(
      secretPairs,
      `${secret.definitionId}:${secret.key}`,
      `Duplicate integration secret key ${secret.key} for definition ${secret.definitionId}`
    )

    const definition = definitionsById.get(secret.definitionId)
    if (!definition) {
      throw new SystemIntegrationValidationError(
        `Integration secret ${secret.id} references unknown definition ${secret.definitionId}`
      )
    }
    if (definition.parentId) {
      throw new SystemIntegrationValidationError(
        `Integration secret ${secret.id} must reference a root integration definition`
      )
    }

    const catalogSecret = catalogSecretsByPair.get(`${secret.definitionId}:${secret.key}`)
    if (!catalogSecret) {
      throw new SystemIntegrationValidationError(
        `Integration secret ${secret.id} uses unsupported credential key ${secret.key} for definition ${secret.definitionId}`
      )
    }

    if (secret.id !== catalogSecret.id) {
      throw new SystemIntegrationValidationError(
        `Integration secret ${secret.id} does not match the catalog seed for ${secret.definitionId}:${secret.key}`
      )
    }
  }
}

function ensureUnique(set: Set<string>, value: string, message: string) {
  if (set.has(value)) {
    throw new SystemIntegrationValidationError(message)
  }
  set.add(value)
}

function sortDefinitionsForInsert(definitions: SystemIntegrationDefinitionInput[]) {
  const remaining = new Map(definitions.map((definition) => [definition.id, definition]))
  const inserted = new Set<string>()
  const sorted: SystemIntegrationDefinitionInput[] = []

  while (remaining.size > 0) {
    let progressed = false

    for (const [id, definition] of Array.from(remaining.entries())) {
      if (!definition.parentId || inserted.has(definition.parentId)) {
        sorted.push(definition)
        inserted.add(id)
        remaining.delete(id)
        progressed = true
      }
    }

    if (!progressed) {
      throw new SystemIntegrationValidationError(
        'System integration definitions contain a parent cycle'
      )
    }
  }

  return sorted
}

function normalizeDefinitionsForCredentialState(
  definitions: SystemIntegrationDefinitionInput[],
  secrets: SystemIntegrationSecretInput[]
) {
  const configuredBundleIds = getConfiguredBundleIds(definitions, secrets)
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))

  return definitions.map((definition) => {
    if (!definition.parentId) {
      return {
        ...definition,
        isEnabled: null,
      }
    }

    const rootDefinitionId = getRootDefinitionId(definition.id, definitionsById)
    const canBeEnabled = rootDefinitionId ? configuredBundleIds.has(rootDefinitionId) : false

    return {
      ...definition,
      isEnabled: canBeEnabled ? Boolean(definition.isEnabled) : false,
    }
  })
}

function getConfiguredBundleIds(
  definitions: SystemIntegrationDefinitionInput[],
  secrets: SystemIntegrationSecretInput[]
) {
  const catalog = getSystemIntegrationCatalogSeedSnapshot()
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const secretValuesByPair = new Map(
    secrets.map((secret) => [
      `${secret.definitionId}:${secret.key}`,
      secret.hasValue || Boolean(secret.value.trim()),
    ])
  )
  const configuredBundleIds = new Set<string>()

  for (const definition of definitions) {
    if (definition.parentId) {
      continue
    }

    const rootDefinitionId = getRootDefinitionId(definition.id, definitionsById)
    if (!rootDefinitionId || rootDefinitionId !== definition.id) {
      continue
    }

    const requiredSecrets = catalog.secrets.filter(
      (secret) => secret.definitionId === definition.id && secret.required
    )
    const isConfigured = requiredSecrets.every((secret) =>
      Boolean(secretValuesByPair.get(`${secret.definitionId}:${secret.key}`))
    )

    if (isConfigured) {
      configuredBundleIds.add(definition.id)
    }
  }

  return configuredBundleIds
}

function getRootDefinitionId(
  definitionId: string,
  definitionsById: Map<string, SystemIntegrationDefinitionInput>
) {
  let currentId: string | null = definitionId
  let rootId: string | null = null
  const visited = new Set<string>()

  while (currentId) {
    if (visited.has(currentId)) {
      throw new SystemIntegrationValidationError(
        `System integration definitions contain a parent cycle at ${currentId}`
      )
    }

    visited.add(currentId)

    const definition = definitionsById.get(currentId)
    if (!definition) {
      return null
    }

    rootId = definition.id
    currentId = definition.parentId
  }

  return rootId
}
