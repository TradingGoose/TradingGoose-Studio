import { db } from '@tradinggoose/db'
import { pendingExecution, systemSettings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { lockPendingExecutionMode } from '@/lib/execution/execution-mode-lock'
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
export type SystemSettingsReadStore = Pick<typeof db, 'select'>
type SystemSettingsWriteStore = Pick<typeof db, 'insert' | 'select'>

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

export class TriggerExecutionBusyError extends Error {
  code = 'trigger_execution_busy' as const

  constructor() {
    super('Trigger.dev execution mode cannot change while executions are queued or running.')
    this.name = 'TriggerExecutionBusyError'
  }
}

export async function getSystemSettingsRecord(
  store: SystemSettingsReadStore = db
): Promise<SystemSettingsRecord | null> {
  const [row] = await store
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

export async function getResolvedSystemSettings(
  store: SystemSettingsReadStore = db
): Promise<ResolvedSystemSettings> {
  const settings = await getSystemSettingsRecord(store)
  const flags = resolveSystemSettingsFlags(settings)

  return {
    settings,
    ...flags,
  }
}

export async function upsertSystemSettings(
  input: UpsertSystemSettingsInput
): Promise<ResolvedSystemSettings> {
  return db.transaction(async (tx) => {
    if (hasInputKey(input, 'triggerDevEnabled')) {
      await lockPendingExecutionMode(tx)
    }

    const existing = await getSystemSettingsRecord(tx)
    const currentTriggerDevEnabled =
      existing?.triggerDevEnabled ?? DEFAULT_SYSTEM_SETTINGS.triggerDevEnabled
    if (
      hasInputKey(input, 'triggerDevEnabled') &&
      input.triggerDevEnabled !== currentTriggerDevEnabled
    ) {
      const [queuedOrRunning] = await tx
        .select({ id: pendingExecution.id })
        .from(pendingExecution)
        .limit(1)
      if (queuedOrRunning) throw new TriggerExecutionBusyError()
    }

    await writeSystemSettings(tx, input, existing)
    return getResolvedSystemSettings(tx)
  })
}

async function writeSystemSettings(
  store: SystemSettingsWriteStore,
  input: UpsertSystemSettingsInput,
  existing: SystemSettingsRecord | null
) {
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
    : normalizeRequiredSystemSetting(existing?.emailDomain, DEFAULT_SYSTEM_SETTINGS.emailDomain)
  const nextFromEmailAddress = hasInputKey(input, 'fromEmailAddress')
    ? normalizeNullableSystemSetting(
        input.fromEmailAddress,
        DEFAULT_SYSTEM_SETTINGS.fromEmailAddress
      )
    : normalizeNullableSystemSetting(
        existing?.fromEmailAddress,
        DEFAULT_SYSTEM_SETTINGS.fromEmailAddress
      )

  await store
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
