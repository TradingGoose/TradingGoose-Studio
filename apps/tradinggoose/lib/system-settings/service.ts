import { db } from '@tradinggoose/db'
import { systemSettings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { DEFAULT_REGISTRATION_MODE, type RegistrationMode } from '@/lib/registration/shared'

export const GLOBAL_SYSTEM_SETTINGS_ID = 'global'

export const DEFAULT_SYSTEM_SETTINGS = {
  registrationMode: DEFAULT_REGISTRATION_MODE,
  billingEnabled: false,
  triggerDevEnabled: false,
  allowPromotionCodes: true,
  emailDomain: 'tradinggoose.ai',
  fromEmailAddress: null,
} as const

type SystemSettingsRecord = typeof systemSettings.$inferSelect

export type UpsertSystemSettingsInput = {
  registrationMode?: RegistrationMode
  billingEnabled?: boolean
  triggerDevEnabled?: boolean
  allowPromotionCodes?: boolean
  emailDomain?: string
  fromEmailAddress?: string | null
}

type ResolvedSystemSettingsFlags = {
  registrationMode: RegistrationMode
  billingEnabled: boolean
  triggerDevEnabled: boolean
  allowPromotionCodes: boolean
  emailDomain: string
  fromEmailAddress: string | null
}

export type ResolvedSystemSettings = {
  settings: SystemSettingsRecord | null
  registrationMode: RegistrationMode
  billingEnabled: boolean
  triggerDevEnabled: boolean
  allowPromotionCodes: boolean
  emailDomain: string
  fromEmailAddress: string | null
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
    | 'registrationMode'
    | 'billingEnabled'
    | 'triggerDevEnabled'
    | 'allowPromotionCodes'
    | 'emailDomain'
    | 'fromEmailAddress'
  > | null
): ResolvedSystemSettingsFlags {
  return {
    registrationMode: settings?.registrationMode ?? DEFAULT_SYSTEM_SETTINGS.registrationMode,
    billingEnabled: settings?.billingEnabled ?? DEFAULT_SYSTEM_SETTINGS.billingEnabled,
    triggerDevEnabled: settings?.triggerDevEnabled ?? DEFAULT_SYSTEM_SETTINGS.triggerDevEnabled,
    allowPromotionCodes:
      settings?.allowPromotionCodes ?? DEFAULT_SYSTEM_SETTINGS.allowPromotionCodes,
    emailDomain: normalizeRequiredSystemSetting(
      settings?.emailDomain,
      DEFAULT_SYSTEM_SETTINGS.emailDomain
    ),
    fromEmailAddress: normalizeNullableSystemSetting(
      settings?.fromEmailAddress,
      DEFAULT_SYSTEM_SETTINGS.fromEmailAddress
    ),
  }
}

export async function getResolvedSystemSettings(): Promise<ResolvedSystemSettings> {
  const settings = await getSystemSettingsRecord()
  const flags = resolveSystemSettingsFlags(settings)

  return {
    settings,
    ...flags,
  }
}

export async function upsertSystemSettings(
  input: UpsertSystemSettingsInput
): Promise<ResolvedSystemSettings> {
  const existing = await getSystemSettingsRecord()
  const now = new Date()

  const nextRegistrationMode =
    input.registrationMode ?? existing?.registrationMode ?? DEFAULT_SYSTEM_SETTINGS.registrationMode
  const nextBillingEnabled =
    input.billingEnabled ?? existing?.billingEnabled ?? DEFAULT_SYSTEM_SETTINGS.billingEnabled
  const nextTriggerDevEnabled =
    input.triggerDevEnabled ??
    existing?.triggerDevEnabled ??
    DEFAULT_SYSTEM_SETTINGS.triggerDevEnabled
  const nextAllowPromotionCodes =
    input.allowPromotionCodes ??
    existing?.allowPromotionCodes ??
    DEFAULT_SYSTEM_SETTINGS.allowPromotionCodes
  const nextEmailDomain = hasInputKey(input, 'emailDomain')
    ? normalizeRequiredSystemSetting(input.emailDomain, DEFAULT_SYSTEM_SETTINGS.emailDomain)
    : normalizeRequiredSystemSetting(
        existing?.emailDomain,
        DEFAULT_SYSTEM_SETTINGS.emailDomain
      )
  const nextFromEmailAddress = hasInputKey(input, 'fromEmailAddress')
    ? normalizeNullableSystemSetting(input.fromEmailAddress, DEFAULT_SYSTEM_SETTINGS.fromEmailAddress)
    : normalizeNullableSystemSetting(
        existing?.fromEmailAddress,
        DEFAULT_SYSTEM_SETTINGS.fromEmailAddress
      )

  await db
    .insert(systemSettings)
    .values({
      id: GLOBAL_SYSTEM_SETTINGS_ID,
      registrationMode: nextRegistrationMode,
      billingEnabled: nextBillingEnabled,
      triggerDevEnabled: nextTriggerDevEnabled,
      allowPromotionCodes: nextAllowPromotionCodes,
      emailDomain: nextEmailDomain,
      fromEmailAddress: nextFromEmailAddress,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.id,
      set: {
        registrationMode: nextRegistrationMode,
        billingEnabled: nextBillingEnabled,
        triggerDevEnabled: nextTriggerDevEnabled,
        allowPromotionCodes: nextAllowPromotionCodes,
        emailDomain: nextEmailDomain,
        fromEmailAddress: nextFromEmailAddress,
        updatedAt: now,
      },
    })

  return getResolvedSystemSettings()
}

function hasInputKey<T extends object, K extends string>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.hasOwn(value, key)
}

function normalizeRequiredSystemSetting(value: string | null | undefined, fallback: string) {
  const normalizedValue = value?.trim()
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : fallback
}

function normalizeNullableSystemSetting(value: string | null | undefined, fallback: string | null) {
  const normalizedValue = value?.trim()
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : fallback
}
