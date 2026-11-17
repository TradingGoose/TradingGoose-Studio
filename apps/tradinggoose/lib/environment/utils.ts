import { db } from '@tradinggoose/db'
import { environmentVariables } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { decryptSecret } from '@/lib/utils-server'

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
  const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
    userId,
    workspaceId
  )
  return decryptAll({ ...personalEncrypted, ...workspaceEncrypted })
}
