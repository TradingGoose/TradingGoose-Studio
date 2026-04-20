import { db } from '@tradinggoose/db'
import { systemBillingSettings } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { hasStripeSecretKey } from '@/lib/system-services/stripe-runtime'
import { getDefaultBillingTier } from '@/lib/billing/tiers'
import { getSystemSettingsRecord, resolveSystemSettingsFlags } from '@/lib/system-settings/service'

type BillingSettingsRecord = typeof systemBillingSettings.$inferSelect
export const GLOBAL_BILLING_SETTINGS_ID = 'global'
export const ADMIN_BILLING_UNAVAILABLE_ERROR =
  'Billing admin is unavailable until STRIPE_SECRET_KEY is configured.'
export const BILLING_DISABLED_ERROR = 'Billing is not enabled.'

export const DEFAULT_BILLING_SETTINGS = {
  onboardingAllowanceUsd: 0,
  overageThresholdDollars: 50,
  workflowExecutionChargeUsd: 0,
  functionExecutionChargeUsd: 0,
  usageWarningThresholdPercent: 80,
  freeTierUpgradeThresholdPercent: 90,
  enterpriseContactUrl: null,
} as const

export async function getBillingSettings(): Promise<BillingSettingsRecord | null> {
  const rows = await db
    .select()
    .from(systemBillingSettings)
    .where(eq(systemBillingSettings.id, GLOBAL_BILLING_SETTINGS_ID))
    .limit(1)
  return rows[0] ?? null
}

export async function isBillingConfigurationReady(): Promise<boolean> {
  return Boolean(await getDefaultBillingTier())
}

export async function getResolvedBillingSettings() {
  const [settings, systemSettings] = await Promise.all([
    getBillingSettings(),
    getSystemSettingsRecord(),
  ])
  const systemFlags = resolveSystemSettingsFlags(systemSettings)
  const stripeConfigured = hasStripeSecretKey()
  const parsedOverageThreshold = Number.parseFloat(
    settings?.overageThresholdDollars?.toString() ?? ''
  )
  const parsedOnboardingAllowance = Number.parseFloat(
    settings?.onboardingAllowanceUsd?.toString() ?? ''
  )
  const parsedWorkflowExecutionCharge = Number.parseFloat(
    settings?.workflowExecutionChargeUsd?.toString() ?? ''
  )
  const parsedFunctionExecutionCharge = Number.parseFloat(
    settings?.functionExecutionChargeUsd?.toString() ?? ''
  )

  return {
    settings,
    billingEnabled: systemFlags.billingEnabled && stripeConfigured,
    stripeConfigured,
    onboardingAllowanceUsd:
      Number.isFinite(parsedOnboardingAllowance) && parsedOnboardingAllowance >= 0
        ? parsedOnboardingAllowance
        : DEFAULT_BILLING_SETTINGS.onboardingAllowanceUsd,
    overageThresholdDollars:
      Number.isFinite(parsedOverageThreshold) && parsedOverageThreshold >= 0
        ? parsedOverageThreshold
        : DEFAULT_BILLING_SETTINGS.overageThresholdDollars,
    workflowExecutionChargeUsd:
      Number.isFinite(parsedWorkflowExecutionCharge) && parsedWorkflowExecutionCharge >= 0
        ? parsedWorkflowExecutionCharge
        : DEFAULT_BILLING_SETTINGS.workflowExecutionChargeUsd,
    functionExecutionChargeUsd:
      Number.isFinite(parsedFunctionExecutionCharge) && parsedFunctionExecutionCharge >= 0
        ? parsedFunctionExecutionCharge
        : DEFAULT_BILLING_SETTINGS.functionExecutionChargeUsd,
    usageWarningThresholdPercent:
      settings?.usageWarningThresholdPercent ??
      DEFAULT_BILLING_SETTINGS.usageWarningThresholdPercent,
    freeTierUpgradeThresholdPercent:
      settings?.freeTierUpgradeThresholdPercent ??
      DEFAULT_BILLING_SETTINGS.freeTierUpgradeThresholdPercent,
    enterpriseContactUrl:
      settings?.enterpriseContactUrl ?? DEFAULT_BILLING_SETTINGS.enterpriseContactUrl,
  }
}

export async function getBillingGateState() {
  const { billingEnabled, stripeConfigured } = await getResolvedBillingSettings()

  return {
    billingEnabled,
    stripeConfigured,
  }
}

export async function isBillingEnabledForRuntime(): Promise<boolean> {
  const { billingEnabled } = await getBillingGateState()
  return billingEnabled
}
