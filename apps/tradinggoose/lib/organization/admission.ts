import { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'

export type OrganizationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Separate lock namespaces keep the user-then-organization order across all admission paths.
const USER_MEMBERSHIP_LOCK = 1_910_620_201
const ORGANIZATION_SEAT_LOCK = 1_910_620_202

export function withOrganizationAdmission<T>(
  target: { userId?: string; organizationId?: string },
  admit: (tx: OrganizationTransaction) => Promise<T>
) {
  return db.transaction(async (tx) => {
    if (target.userId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${USER_MEMBERSHIP_LOCK}, hashtext(${target.userId}))`
      )
    }
    if (target.organizationId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${ORGANIZATION_SEAT_LOCK}, hashtext(${target.organizationId}))`
      )
    }
    return admit(tx)
  })
}
