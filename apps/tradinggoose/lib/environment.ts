/**
 * Environment utility functions for consistent environment detection across the application
 */
import { env, getEnv, isTruthy } from './env'

/**
 * Is the application running in production mode
 */
export const isProd = env.NODE_ENV === 'production'

/**
 * Is the application running in development mode
 */
export const isDev = env.NODE_ENV === 'development'

/**
 * Is the application running in test mode
 */
export const isTest = env.NODE_ENV === 'test'

/**
 * Is this the hosted version of the application
 */
const HOSTED_HOSTNAMES = [
  'www.tradinggoose.ai',
  'tradinggoose.ai',
  'preview.tradinggoose.ai',
  'staging.tradinggoose.ai',
]

function extractHostname(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}

export const isHosted = HOSTED_HOSTNAMES.includes(extractHostname(getEnv('NEXT_PUBLIC_APP_URL')))

/**
 * Is email verification enabled
 */
export const isEmailVerificationEnabled = isTruthy(env.EMAIL_VERIFICATION_ENABLED)
