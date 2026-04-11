import { db } from '@tradinggoose/db'
import { systemSettings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { DEFAULT_REGISTRATION_MODE, type RegistrationMode } from '@/lib/registration/shared'
import { decryptSecret, encryptSecret } from '@/lib/utils'

const logger = createLogger('SystemSettingsService')

export const GLOBAL_SYSTEM_SETTINGS_ID = 'global'

export const DEFAULT_SYSTEM_SETTINGS = {
  registrationMode: DEFAULT_REGISTRATION_MODE,
  billingEnabled: false,
  allowPromotionCodes: true,
  stripeSecretKey: null,
  stripeWebhookSecret: null,
} as const

type SystemSettingsRecord = typeof systemSettings.$inferSelect

export type UpsertSystemSettingsInput = {
  registrationMode?: RegistrationMode
  billingEnabled?: boolean
  allowPromotionCodes?: boolean
  stripeSecretKey?: string | null
  stripeWebhookSecret?: string | null
}

type ResolvedSystemSettingsFlags = {
  registrationMode: RegistrationMode
  billingEnabled: boolean
  allowPromotionCodes: boolean
}

export type ResolvedSystemSettings = {
  settings: SystemSettingsRecord | null
  registrationMode: RegistrationMode
  billingEnabled: boolean
  allowPromotionCodes: boolean
  stripeSecretKey: string | null
  stripeWebhookSecret: string | null
}

export async function getSystemSettingsRecord(): Promise<SystemSettingsRecord | null> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, GLOBAL_SYSTEM_SETTINGS_ID))
    .limit(1)

  return row ?? null
}

export function resolveSystemSettingsFlags(
  settings: Pick<
    SystemSettingsRecord,
    'registrationMode' | 'billingEnabled' | 'allowPromotionCodes'
  > | null
): ResolvedSystemSettingsFlags {
  return {
    registrationMode: settings?.registrationMode ?? DEFAULT_SYSTEM_SETTINGS.registrationMode,
    billingEnabled: settings?.billingEnabled ?? DEFAULT_SYSTEM_SETTINGS.billingEnabled,
    allowPromotionCodes:
      settings?.allowPromotionCodes ?? DEFAULT_SYSTEM_SETTINGS.allowPromotionCodes,
  }
}

export async function getResolvedSystemSettings(): Promise<ResolvedSystemSettings> {
  const settings = await getSystemSettingsRecord()
  const flags = resolveSystemSettingsFlags(settings)
  const [stripeSecretKey, stripeWebhookSecret] = await Promise.all([
    decryptStoredSystemSecret('STRIPE_SECRET_KEY', settings?.stripeSecretKey ?? null),
    decryptStoredSystemSecret('STRIPE_WEBHOOK_SECRET', settings?.stripeWebhookSecret ?? null),
  ])

  return {
    settings,
    ...flags,
    stripeSecretKey,
    stripeWebhookSecret,
  }
}

export async function upsertSystemSettings(
  input: UpsertSystemSettingsInput
): Promise<ResolvedSystemSettings> {
  const existing = await getSystemSettingsRecord()
  const now = new Date()
  const hasStripeSecretKey = hasInputKey(input, 'stripeSecretKey')
  const hasStripeWebhookSecret = hasInputKey(input, 'stripeWebhookSecret')

  const nextRegistrationMode =
    input.registrationMode ?? existing?.registrationMode ?? DEFAULT_SYSTEM_SETTINGS.registrationMode
  const nextBillingEnabled =
    input.billingEnabled ?? existing?.billingEnabled ?? DEFAULT_SYSTEM_SETTINGS.billingEnabled
  const nextAllowPromotionCodes =
    input.allowPromotionCodes ??
    existing?.allowPromotionCodes ??
    DEFAULT_SYSTEM_SETTINGS.allowPromotionCodes
  const nextStripeSecretKey = hasStripeSecretKey
    ? await encryptNullableSystemSecret(input.stripeSecretKey ?? null)
    : (existing?.stripeSecretKey ?? null)
  const nextStripeWebhookSecret = hasStripeWebhookSecret
    ? await encryptNullableSystemSecret(input.stripeWebhookSecret ?? null)
    : (existing?.stripeWebhookSecret ?? null)

  await db
    .insert(systemSettings)
    .values({
      id: GLOBAL_SYSTEM_SETTINGS_ID,
      registrationMode: nextRegistrationMode,
      billingEnabled: nextBillingEnabled,
      allowPromotionCodes: nextAllowPromotionCodes,
      stripeSecretKey: nextStripeSecretKey,
      stripeWebhookSecret: nextStripeWebhookSecret,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.id,
      set: {
        registrationMode: nextRegistrationMode,
        billingEnabled: nextBillingEnabled,
        allowPromotionCodes: nextAllowPromotionCodes,
        stripeSecretKey: nextStripeSecretKey,
        stripeWebhookSecret: nextStripeWebhookSecret,
        updatedAt: now,
      },
    })

  return getResolvedSystemSettings()
}

async function decryptStoredSystemSecret(key: string, encryptedValue: string | null) {
  if (!encryptedValue?.trim()) {
    return null
  }

  try {
    const { decrypted } = await decryptSecret(encryptedValue)
    const trimmed = decrypted.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (error) {
    logger.error('Failed to decrypt system setting secret', { key, error })
    return null
  }
}

async function encryptNullableSystemSecret(value: string | null) {
  const normalizedValue = value?.trim() ?? ''
  if (!normalizedValue) {
    return null
  }

  const { encrypted } = await encryptSecret(normalizedValue)
  return encrypted
}

function hasInputKey<T extends object, K extends string>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.hasOwn(value, key)
}
