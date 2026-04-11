'use server'

import { isProd } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthProviderAvailability } from '@/lib/oauth/provider-availability.server'

const logger = createLogger('OAuthProviderChecker')

export async function getOAuthProviderStatus() {
  try {
    const availability = await getOAuthProviderAvailability(['github', 'google'])
    const githubAvailable = Boolean(availability.github)
    const googleAvailable = Boolean(availability.google)

    return { githubAvailable, googleAvailable, isProduction: isProd }
  } catch (error) {
    logger.error('Failed to resolve social OAuth provider availability', error)

    return {
      githubAvailable: false,
      googleAvailable: false,
      isProduction: isProd,
    }
  }
}
