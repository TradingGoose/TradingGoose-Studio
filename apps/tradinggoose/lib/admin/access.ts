import { db } from '@tradinggoose/db'
import { systemAdmin } from '@tradinggoose/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth'

const SYSTEM_ADMIN_BOOTSTRAP_LOCK_ID = 3_816_420_551

export async function isSystemAdmin(userId: string) {
  const [row] = await db
    .select({ userId: systemAdmin.userId })
    .from(systemAdmin)
    .where(eq(systemAdmin.userId, userId))
    .limit(1)

  return Boolean(row)
}

export async function hasSystemAdmin() {
  const [row] = await db.select({ userId: systemAdmin.userId }).from(systemAdmin).limit(1)
  return Boolean(row)
}

export async function claimFirstSystemAdmin(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SYSTEM_ADMIN_BOOTSTRAP_LOCK_ID})`)

    const [row] = await tx.select({ userId: systemAdmin.userId }).from(systemAdmin).limit(1)
    if (row) {
      return false
    }

    await tx.insert(systemAdmin).values({
      id: crypto.randomUUID(),
      userId,
    })

    return true
  })
}

export async function getSystemAdminAccess() {
  const session = await getSession()
  const user = session?.user ?? null
  const userId = user?.id ?? null

  if (!userId) {
    return {
      session: null,
      user: null,
      userId: null,
      isAuthenticated: false,
      isSystemAdmin: false,
      canBootstrapSystemAdmin: false,
    }
  }

  const isAdmin = await isSystemAdmin(userId)
  const canBootstrapSystemAdmin = isAdmin ? false : !(await hasSystemAdmin())

  return {
    session,
    user,
    userId,
    isAuthenticated: true,
    isSystemAdmin: isAdmin,
    canBootstrapSystemAdmin,
  }
}
