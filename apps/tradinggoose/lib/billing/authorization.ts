import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { BillingReference } from '@/lib/billing/tiers'

/**
 * Check if a user is authorized to manage billing for a given subject.
 */
export async function authorizeSubscriptionReference(
  userId: string,
  reference: BillingReference
): Promise<boolean> {
  const { referenceId, referenceType } = reference

  if (referenceType === 'user') {
    return referenceId === userId
  }

  const members = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, referenceId)))

  const member = members[0]
  return member?.role === 'owner'
}
