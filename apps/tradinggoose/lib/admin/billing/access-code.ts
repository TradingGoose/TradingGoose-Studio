import { db } from '@tradinggoose/db'
import { systemBillingTier } from '@tradinggoose/db/schema'
import { and, eq, ne } from 'drizzle-orm'

export async function privateTierAccessCodeExists(
  accessCode: string,
  excludeTierId?: string
): Promise<boolean> {
  const conditions = [
    eq(systemBillingTier.isPublic, false),
    eq(systemBillingTier.accessCode, accessCode),
  ]
  if (excludeTierId) conditions.push(ne(systemBillingTier.id, excludeTierId))
  const rows = await db
    .select({ id: systemBillingTier.id })
    .from(systemBillingTier)
    .where(and(...conditions))
    .limit(1)
  return rows.length > 0
}

export function isAccessCodeUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause as {
    code?: unknown
    constraint_name?: unknown
  }
  return (
    cause?.code === '23505' && cause?.constraint_name === 'system_billing_tier_access_code_unique'
  )
}
