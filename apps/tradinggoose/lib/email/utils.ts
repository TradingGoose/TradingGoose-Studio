import { getResolvedSystemSettings } from '@/lib/system-settings/service'

/**
 * Get the platform email domain from DB-backed system settings.
 */
export async function getConfiguredEmailDomain(): Promise<string> {
  const settings = await getResolvedSystemSettings()
  return settings.emailDomain
}

/**
 * Get the from email address from DB-backed system settings.
 */
export async function getFromEmailAddress(): Promise<string> {
  const settings = await getResolvedSystemSettings()
  return settings.fromEmailAddress?.trim() || `noreply@${settings.emailDomain}`
}

/**
 * Get the help/support inbox address from DB-backed system settings.
 */
export async function getHelpEmailAddress(): Promise<string> {
  return `help@${await getConfiguredEmailDomain()}`
}
