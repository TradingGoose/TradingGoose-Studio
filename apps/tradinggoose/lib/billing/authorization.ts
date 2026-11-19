import { db } from '@tradinggoose/db'
import { member } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { BillingReference } from '@/lib/billing/tiers'

export async function getOrganizationMemberRole(organizationId: string, userId: string) {
  const memberRecord = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  return memberRecord[0]?.role ?? null
}

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

  return (await getOrganizationMemberRole(referenceId, userId)) === 'owner'
}
