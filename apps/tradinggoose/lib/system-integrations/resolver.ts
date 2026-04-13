import { db } from '@tradinggoose/db'
import { systemIntegrationDefinition, systemIntegrationSecret } from '@tradinggoose/db/schema'
import { inArray } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { getSystemIntegrationCatalogSeedSnapshot } from '@/lib/system-integrations/catalog'
import { decryptSecret } from '@/lib/utils-server'

const logger = createLogger('SystemIntegrationResolver')

type SystemIntegrationDefinitionRecord = typeof systemIntegrationDefinition.$inferSelect
type SystemIntegrationSecretRecord = typeof systemIntegrationSecret.$inferSelect

export interface ResolvedSystemIntegrationDefinition {
  definition: SystemIntegrationDefinitionRecord
  rootDefinition: SystemIntegrationDefinitionRecord
  lineage: SystemIntegrationDefinitionRecord[]
  isEnabled: boolean
  secrets: Record<string, string>
}

export async function resolveSystemIntegrationDefinitions(
  definitionIds: string[]
): Promise<Record<string, ResolvedSystemIntegrationDefinition | null>> {
  const normalizedDefinitionIds = Array.from(
    new Set(definitionIds.map((definitionId) => definitionId.trim()).filter(Boolean))
  )

  if (normalizedDefinitionIds.length === 0) {
    return {}
  }

  const definitionsById = await listDefinitionsById()
  const lineagesByDefinitionId = new Map<string, SystemIntegrationDefinitionRecord[] | null>()
  const rootDefinitionIds = new Set<string>()

  for (const definitionId of normalizedDefinitionIds) {
    const lineage = getDefinitionLineage(definitionId, definitionsById)
    lineagesByDefinitionId.set(definitionId, lineage)

    if (lineage && lineage.length > 0) {
      rootDefinitionIds.add(lineage[lineage.length - 1]!.id)
    }
  }

  const decryptedSecretsByDefinitionId = await listDecryptedSecretsByDefinitionId(
    Array.from(rootDefinitionIds)
  )

  const resolved: Record<string, ResolvedSystemIntegrationDefinition | null> = {}

  for (const definitionId of normalizedDefinitionIds) {
    const lineage = lineagesByDefinitionId.get(definitionId) ?? null

    if (!lineage || lineage.length === 0) {
      resolved[definitionId] = null
      continue
    }

    const definition = lineage[0]!
    const rootDefinition = lineage[lineage.length - 1]!
    const serviceLineage = lineage.filter((item) => item.parentId !== null)

    resolved[definitionId] = {
      definition,
      rootDefinition,
      lineage,
      isEnabled:
        serviceLineage.length > 0 &&
        serviceLineage.every((item) => item.isEnabled === true) &&
        hasRequiredSecrets(
          rootDefinition.id,
          decryptedSecretsByDefinitionId.get(rootDefinition.id) ?? {}
        ),
      secrets: decryptedSecretsByDefinitionId.get(rootDefinition.id) ?? {},
    }
  }

  return resolved
}

async function listDefinitionsById() {
  const rows = await db.select().from(systemIntegrationDefinition)
  return new Map(rows.map((row) => [row.id, row]))
}

function getDefinitionLineage(
  definitionId: string,
  definitionsById: Map<string, SystemIntegrationDefinitionRecord>
) {
  const lineage: SystemIntegrationDefinitionRecord[] = []
  const visited = new Set<string>()
  let currentId: string | null = definitionId

  while (currentId) {
    if (visited.has(currentId)) {
      logger.error('Detected system integration definition cycle while resolving lineage', {
        definitionId,
        currentId,
      })
      return null
    }

    visited.add(currentId)

    const definition = definitionsById.get(currentId)
    if (!definition) {
      logger.error('System integration definition is missing during lineage resolution', {
        definitionId,
        missingDefinitionId: currentId,
      })
      return null
    }

    lineage.push(definition)
    currentId = definition.parentId
  }

  return lineage
}

async function listDecryptedSecretsByDefinitionId(definitionIds: string[]) {
  const uniqueDefinitionIds = Array.from(new Set(definitionIds.filter(Boolean)))
  if (uniqueDefinitionIds.length === 0) {
    return new Map<string, Record<string, string>>()
  }

  const rows = await db
    .select()
    .from(systemIntegrationSecret)
    .where(inArray(systemIntegrationSecret.definitionId, uniqueDefinitionIds))

  const groupedRows = new Map<string, SystemIntegrationSecretRecord[]>()
  for (const row of rows) {
    const group = groupedRows.get(row.definitionId)
    if (group) {
      group.push(row)
    } else {
      groupedRows.set(row.definitionId, [row])
    }
  }

  const decryptedEntries = await Promise.all(
    Array.from(groupedRows.entries()).map(async ([definitionId, secretRows]) => {
      const secrets: Record<string, string> = {}

      await Promise.all(
        secretRows.map(async (secret) => {
          try {
            const { decrypted } = await decryptSecret(secret.value)
            secrets[secret.key] = decrypted
          } catch (error) {
            logger.error('Failed to decrypt system integration secret', {
              definitionId,
              secretId: secret.id,
              secretKey: secret.key,
              error,
            })
          }
        })
      )

      return [definitionId, secrets] as const
    })
  )

  return new Map(decryptedEntries)
}

function hasRequiredSecrets(rootDefinitionId: string, secrets: Record<string, string>) {
  const catalog = getSystemIntegrationCatalogSeedSnapshot()
  const requiredSecrets = catalog.secrets.filter(
    (secret) => secret.definitionId === rootDefinitionId && secret.required
  )

  return requiredSecrets.every((secret) => Boolean(secrets[secret.key]?.trim()))
}
