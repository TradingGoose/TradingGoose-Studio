import type { SSOOptions } from '@better-auth/sso'
import { APIError } from 'better-auth/api'
import { hasOrganizationMembership } from '@/lib/billing/core/organization'
import { validateSeatAvailability } from '@/lib/billing/validation/seat-management'
import { requireOrganizationSsoEnabled } from '@/lib/sso/management'

export const ssoOptions = {
  domainVerification: { enabled: true },
  organizationProvisioning: {
    getRole: async ({ user, provider }) => {
      const organizationId = provider.organizationId
      if (!organizationId) throw new APIError('BAD_REQUEST', { message: 'Organization required' })
      const { billingEnabled } = await requireOrganizationSsoEnabled(organizationId)
      if (await hasOrganizationMembership(user.id)) {
        throw new APIError('FORBIDDEN', {
          message: 'Already a member of an organization',
        })
      }
      if (billingEnabled) {
        const seats = await validateSeatAvailability(organizationId)
        if (!seats.canInvite) {
          throw new APIError('FORBIDDEN', { message: seats.reason ?? 'No available seats' })
        }
      }
      return 'member'
    },
  },
  saml: { allowIdpInitiated: true, idpInitiatedCallbackUrl: '/signup?complete=username' },
} satisfies SSOOptions
