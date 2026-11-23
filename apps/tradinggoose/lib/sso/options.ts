import { defineRequestState } from '@better-auth/core/context'
import type { SSOOptions } from '@better-auth/sso'
import { APIError } from 'better-auth/api'

export const ssoAdmission = defineRequestState<{
  organizationId: string
  userId: string
  email: string
} | null>(() => null)

export const ssoOptions = {
  domainVerification: { enabled: true },
  organizationProvisioning: {
    getRole: async ({ user, provider }) => {
      const organizationId = provider.organizationId
      if (!organizationId) throw new APIError('BAD_REQUEST', { message: 'Organization required' })
      await ssoAdmission.set({ organizationId, userId: user.id, email: user.email })
      return 'member'
    },
  },
  saml: { allowIdpInitiated: true, idpInitiatedCallbackUrl: '/signup?complete=username' },
} satisfies SSOOptions
