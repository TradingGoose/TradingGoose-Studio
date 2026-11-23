import { createHash } from 'node:crypto'
import { defineRequestState, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'
import type { DBAdapter } from 'better-auth'
import { APIError } from 'better-auth/api'

export const emailChangeDeliveryFailed = defineRequestState(() => false)

// The plugin's target identifier already contains the account ID and target address.
// Include the current mailbox whose proof authorized this challenge.
export async function hashEmailChangeIdentifier(identifier: string) {
  const email = tryGetCurrentAuthEndpointContext()?.context.session?.user.email.toLowerCase()
  if (!email) {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_OTP', message: 'Invalid OTP' })
  }
  return createHash('sha256')
    .update(JSON.stringify([identifier, email]))
    .digest('base64url')
}

export function bindEmailChangeUpdate(adapter: DBAdapter): DBAdapter {
  return {
    ...adapter,
    async update<T>(args: Parameters<DBAdapter['update']>[0]) {
      const ctx = tryGetCurrentAuthEndpointContext()
      if (args.model !== 'user' || !args.update.email || ctx?.path !== '/email-otp/change-email') {
        return adapter.update<T>(args)
      }
      const owner = ctx.context.session?.user
      const updated =
        owner &&
        (await adapter.update<T>({
          ...args,
          where: [
            ...args.where,
            { field: 'id', value: owner.id },
            { field: 'email', value: owner.email },
          ],
        }))
      if (!updated) {
        throw new APIError('CONFLICT', {
          code: 'CURRENT_EMAIL_CHANGED',
          message: 'Your account email changed. Request a fresh link.',
        })
      }
      return updated
    },
  }
}
