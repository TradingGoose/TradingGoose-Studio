'use server'

import { isProd } from '@/lib/environment'
import { getOAuthProviderAvailability } from '@/lib/oauth/oauth'

export async function getOAuthProviderStatus() {
  const availability = getOAuthProviderAvailability(['github', 'google'])
  const githubAvailable = Boolean(availability.github)
  const googleAvailable = Boolean(availability.google)

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
