import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('EnvironmentUtils')

function buildEncryptedMap(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

async function decryptAll(src: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) {
    try {
      const { decrypted } = await decryptSecret(v)
      out[k] = decrypted
    } catch {
      out[k] = ''
    }
  }
  return out
}

/**
 * Get environment variable keys for a user
 * Returns only the variable names, not their values
 */
export async function getEnvironmentVariableKeys(userId: string): Promise<{
  variableNames: string[]
  count: number
}> {
  try {
    const rows = await db
      .select({ key: environmentVariables.key })
      .from(environmentVariables)
      .where(eq(environmentVariables.userId, userId))

    const variableNames = rows.map((row) => row.key)

    return {
      variableNames,
      count: variableNames.length,
    }
  } catch (error) {
    logger.error('Error getting environment variable keys:', error)
    throw new Error('Failed to get environment variables')
  }
}

export async function getPersonalAndWorkspaceEnv(
  userId: string,
  workspaceId?: string
): Promise<{
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  conflicts: string[]
}> {
  const [personalRows, workspaceRows] = await Promise.all([
    db
      .select({
        key: environmentVariables.key,
        value: environmentVariables.value,
      })
      .from(environmentVariables)
      .where(eq(environmentVariables.userId, userId)),
    workspaceId
      ? db
          .select({
            key: environmentVariables.key,
            value: environmentVariables.value,
          })
          .from(environmentVariables)
          .where(eq(environmentVariables.workspaceId, workspaceId))
      : Promise.resolve([] as Array<{ key: string; value: string }>),
  ])

  const personalEncrypted = buildEncryptedMap(personalRows)
  const workspaceEncrypted = buildEncryptedMap(workspaceRows)

  const conflicts = Object.keys(personalEncrypted).filter((k) => k in workspaceEncrypted)

  return {
    personalEncrypted,
    workspaceEncrypted,
    conflicts,
  }
}

export async function getEffectiveDecryptedEnv(
  userId: string,
  workspaceId?: string
): Promise<Record<string, string>> {
  const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(userId, workspaceId)
  return decryptAll({ ...personalEncrypted, ...workspaceEncrypted })
}
