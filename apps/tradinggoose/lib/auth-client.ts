import { ssoClient } from '@better-auth/sso/client'
import { stripeClient } from '@better-auth/stripe/client'
import {
  emailOTPClient,
  genericOAuthClient,
  organizationClient,
  usernameClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { env } from '@/lib/env'

export const client = createAuthClient({
  ...(typeof window === 'undefined' ? {} : { baseURL: window.location.origin }),
  plugins: [
    usernameClient(),
    emailOTPClient(),
    genericOAuthClient(),
    stripeClient({
      subscription: true,
    }),
    organizationClient(),
    ...(env.NEXT_PUBLIC_SSO_ENABLED ? [ssoClient({ domainVerification: { enabled: true } })] : []),
  ],
})

export const { useSession, useActiveOrganization, signOut } = client
