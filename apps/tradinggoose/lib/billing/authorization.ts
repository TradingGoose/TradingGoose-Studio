import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { BillingReference } from '@/lib/billing/tiers'

function toBillingReference(
  userId: string,
  reference: string | BillingReference
): BillingReference {
  if (typeof reference !== 'string') {
    return reference
  }

  return {
    referenceType: reference === userId ? 'user' : 'organization',
    referenceId: reference,
  }
}

/**
 * Check if a user is authorized to manage billing for a given subject.
 */
export async function authorizeSubscriptionReference(
  userId: string,
  reference: string | BillingReference
): Promise<boolean> {
  const { referenceId, referenceType } = toBillingReference(userId, reference)

  if (referenceType === 'user') {
    return referenceId === userId
  }

  if (referenceId === userId) {
    return true
  }

  const members = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.userId, userId), eq(schema.member.organizationId, referenceId)))

  const member = members[0]
  return member?.role === 'owner' || member?.role === 'admin'
}
