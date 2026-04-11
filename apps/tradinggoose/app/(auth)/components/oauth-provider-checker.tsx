'use server'

import { getEnv } from '@/lib/env'
import { isProd } from '@/lib/environment'

export async function getOAuthProviderStatus() {
  const githubAvailable = Boolean(
    getEnv('GITHUB_CLIENT_ID')?.trim() && getEnv('GITHUB_CLIENT_SECRET')?.trim()
  )
  const googleAvailable = Boolean(
    getEnv('GOOGLE_CLIENT_ID')?.trim() && getEnv('GOOGLE_CLIENT_SECRET')?.trim()
  )

  return { githubAvailable, googleAvailable, isProduction: isProd }
}
