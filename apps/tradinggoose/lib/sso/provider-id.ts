import { APIError } from 'better-auth/api'
import { isSystemIntegrationManagedOAuthServiceProviderId } from '@/lib/oauth/oauth'

// The 63-character DNS label also contains the "_better-auth-token-" prefix.
export const MAX_SSO_PROVIDER_ID_LENGTH = 44

export function assertSsoProviderIdAllowed(providerId: unknown) {
  if (typeof providerId !== 'string') return
  if (isSystemIntegrationManagedOAuthServiceProviderId(providerId)) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: 'This providerId is reserved and cannot be used for an SSO provider',
    })
  }
  if (providerId.length > MAX_SSO_PROVIDER_ID_LENGTH) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      message: `SSO provider IDs must be ${MAX_SSO_PROVIDER_ID_LENGTH} characters or fewer`,
    })
  }
}
