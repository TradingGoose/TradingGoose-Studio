import { hasRequestState, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import { db } from '@tradinggoose/db'
import * as schema from '@tradinggoose/db/schema'
import type { BetterAuthOptions, DBAdapter } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { bindEmailChangeUpdate } from '@/lib/auth/email-change'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import {
  type OrganizationTransaction,
  withOrganizationAdmission,
} from '@/lib/organization/admission'
import { requireOrganizationSsoEnabled } from '@/lib/sso/management'
import { ssoAdmission } from '@/lib/sso/options'

export const nativeAuthDatabase = (store: typeof db | OrganizationTransaction) =>
  drizzleAdapter(store, { provider: 'pg', schema })

export function authDatabase(options: BetterAuthOptions): DBAdapter {
  const adapter = bindEmailChangeUpdate(nativeAuthDatabase(db)(options))
  return {
    ...adapter,
    async create<T extends Record<string, unknown>, R = T>(
      input: Parameters<DBAdapter['create']>[0]
    ): Promise<R> {
      if (input.model !== 'member') return adapter.create(input)
      const { userId, organizationId } = input.data
      return withOrganizationAdmission({ userId, organizationId }, async (tx) => {
        const writer = nativeAuthDatabase(tx)(options)
        const where = [{ field: 'userId', value: userId }]
        const sameOrganization = await writer.findOne<R>({
          model: 'member',
          where: [...where, { field: 'organizationId', value: organizationId }],
          select: input.select,
        })
        if (sameOrganization) return sameOrganization
        if (await writer.findOne({ model: 'member', where, select: ['id'] })) {
          throw new APIError('FORBIDDEN', { message: 'Already a member of an organization' })
        }

        const source = (await hasRequestState()) ? await ssoAdmission.get() : null
        const provisioning =
          source && source.organizationId === organizationId && source.userId === userId
            ? source
            : null
        if (
          provisioning &&
          (await writer.findOne({
            model: 'invitation',
            where: [
              { field: 'organizationId', value: organizationId },
              { field: 'email', value: provisioning.email.toLowerCase() },
              { field: 'status', value: 'pending' },
              { field: 'expiresAt', value: new Date(), operator: 'gt' },
            ],
          }))
        ) {
          throw new APIError('CONFLICT', { message: 'Accept your pending organization invitation' })
        }
        const creatingOrganization =
          tryGetCurrentAuthEndpointContext()?.path === '/organization/create'
        const checkSeats = provisioning
          ? (await requireOrganizationSsoEnabled(organizationId, tx)).billingEnabled
          : !creatingOrganization
        if (checkSeats) {
          const seats = await validateSeatAvailability(organizationId, 1, tx)
          if (!seats.canInvite) {
            throw new APIError('FORBIDDEN', { message: seats.reason ?? 'No available seats' })
          }
        }
        return writer.create(input)
      })
    },
  }
}
