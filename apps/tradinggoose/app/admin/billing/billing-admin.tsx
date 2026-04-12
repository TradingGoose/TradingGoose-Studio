'use client'

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Receipt, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@/components/ui'
import type { AdminBillingSettingsMutationInput } from '@/lib/admin/billing/settings-mutations'
import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { cn } from '@/lib/utils'
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import {
  EmptyStateCard,
  PrimaryButton,
  SearchInput,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  useAdminBillingSnapshot,
  useCreateAdminBillingTier,
  useUpdateAdminBillingSettings,
} from '@/hooks/queries/admin-billing'

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export type TierFormDefaults = {
  displayName: string
  description: string
  status: AdminBillingTierMutationInput['status']
  ownerType: AdminBillingTierMutationInput['ownerType']
  usageScope: AdminBillingTierMutationInput['usageScope']
  seatMode: AdminBillingTierMutationInput['seatMode']
  monthlyPriceUsd: string
  yearlyPriceUsd: string
  includedUsageLimitUsd: string
  storageLimitGb: string
  concurrencyLimit: string
  seatCount: string
  seatMaximum: string
  stripeMonthlyPriceId: string
  stripeYearlyPriceId: string
  stripeProductId: string
  syncRateLimitPerMinute: string
  asyncRateLimitPerMinute: string
  apiEndpointRateLimitPerMinute: string
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: string
  workflowModelCostMultiplier: string
  functionExecutionDurationMultiplier: string
  copilotCostMultiplier: string
  pricingFeatures: string
  isPublic: boolean
  isDefault: boolean
  displayOrder: string
}

type BillingSettingsFormDefaults = {
  onboardingAllowanceUsd: string
  overageThresholdDollars: string
  workflowExecutionChargeUsd: string
  functionExecutionChargeUsd: string
  usageWarningThresholdPercent: string
  freeTierUpgradeThresholdPercent: string
  enterpriseContactUrl: string
}

const TIER_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const

const TIER_OWNER_TYPE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'organization', label: 'Organization' },
] as const

const TIER_USAGE_SCOPE_OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'pooled', label: 'Pooled' },
] as const

const TIER_SEAT_MODE_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'adjustable', label: 'Adjustable' },
] as const

export const DEFAULT_TIER_EDITOR_SECTIONS = {
  general: true,
  pricing: true,
  access: true,
  seats: false,
  limits: true,
  metering: false,
} as const

export type TierEditorSectionId = keyof typeof DEFAULT_TIER_EDITOR_SECTIONS

export type TierEditorSectionState = Record<TierEditorSectionId, boolean>

type TierSectionSummary = {
  preview: string
  missing: string | null
  status: 'ready' | 'review' | 'optional'
}

export type TierDerivedAccessFields = Pick<
  TierFormDefaults,
  'ownerType' | 'usageScope' | 'seatMode'
>
type TierCommerceLabel = 'free' | 'self-serve' | 'contact-sales'

type BillingBreadcrumbItem = {
  label: string
  href?: string
}

export function BillingBreadcrumbs({ items }: { items: BillingBreadcrumbItem[] }) {
  const currentLabel = items[items.length - 1]?.label ?? 'Billing'

  return (
    <>
      <div className='hidden items-center gap-2 sm:flex'>
        {items.map((item, index) => {
          const key = `${item.label}-${item.href || index}`

          return (
            <div key={key} className='flex items-center gap-2'>
              {index === 0 && <ShieldCheck className='h-[18px] w-[18px] text-muted-foreground' />}

              {item.href ? (
                <Link
                  href={item.href}
                  prefetch={true}
                  className='font-medium text-sm transition-colors hover:text-muted-foreground'
                >
                  {item.label}
                </Link>
              ) : (
                <span className='font-medium text-sm'>{item.label}</span>
              )}

              {index < items.length - 1 && <span className='text-muted-foreground'>/</span>}
            </div>
          )
        })}
      </div>

      <div className='flex flex-1 items-center gap-1 text-muted-foreground text-sm sm:hidden'>
        <ShieldCheck className='h-[16px] w-[16px]' />
        <span className='truncate'>{currentLabel}</span>
      </div>
    </>
  )
}

const TIER_SECTION_STATUS_BADGE_CLASSNAME = {
  ready: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  review: 'bg-destructive/15 text-destructive border-destructive/20',
  optional: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
} as const

function formatOptionalNumber(value: number | null) {
  return value === null ? '' : value.toString()
}

function normalizeTierAccessFields(fields: TierDerivedAccessFields): TierDerivedAccessFields {
  if (fields.ownerType === 'user') {
    return {
      ownerType: 'user',
      usageScope: 'individual',
      seatMode: 'fixed',
    }
  }

  return {
    ownerType: 'organization',
    usageScope: fields.usageScope === 'pooled' ? 'pooled' : 'individual',
    seatMode: fields.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
  }
}

function getTierCommerceLabel(defaults: {
  monthlyPriceUsd: string
  yearlyPriceUsd: string
  isPublic: boolean
  stripeMonthlyPriceId: string
  stripeYearlyPriceId: string
}): TierCommerceLabel {
  const hasMonthlyPrice = hasPositiveNumber(defaults.monthlyPriceUsd)
  const hasYearlyPrice = hasPositiveNumber(defaults.yearlyPriceUsd)

  if (!hasMonthlyPrice && !hasYearlyPrice) {
    return 'free'
  }

  if (
    defaults.isPublic &&
    (isFilled(defaults.stripeMonthlyPriceId) || isFilled(defaults.stripeYearlyPriceId))
  ) {
    return 'self-serve'
  }

  return 'contact-sales'
}

export function normalizeTierFormDefaults(defaults: TierFormDefaults): TierFormDefaults {
  return {
    ...defaults,
    ...normalizeTierAccessFields(defaults),
  }
}

export function createTierFormDefaults(tier?: AdminBillingTierSnapshot): TierFormDefaults {
  return normalizeTierFormDefaults({
    displayName: tier?.displayName ?? '',
    description: tier?.description ?? '',
    status: tier?.status ?? 'draft',
    ownerType: tier?.ownerType ?? 'user',
    usageScope: tier?.usageScope ?? 'individual',
    seatMode: tier?.seatMode === 'adjustable' ? 'adjustable' : 'fixed',
    monthlyPriceUsd: formatOptionalNumber(tier?.monthlyPriceUsd ?? null),
    yearlyPriceUsd: formatOptionalNumber(tier?.yearlyPriceUsd ?? null),
    includedUsageLimitUsd: formatOptionalNumber(tier?.includedUsageLimitUsd ?? null),
    storageLimitGb: formatOptionalNumber(tier?.storageLimitGb ?? null),
    concurrencyLimit: formatOptionalNumber(tier?.concurrencyLimit ?? null),
    seatCount: formatOptionalNumber(tier?.seatCount ?? null),
    seatMaximum: formatOptionalNumber(tier?.seatMaximum ?? null),
    stripeMonthlyPriceId: tier?.stripeMonthlyPriceId ?? '',
    stripeYearlyPriceId: tier?.stripeYearlyPriceId ?? '',
    stripeProductId: tier?.stripeProductId ?? '',
    syncRateLimitPerMinute: formatOptionalNumber(tier?.syncRateLimitPerMinute ?? null),
    asyncRateLimitPerMinute: formatOptionalNumber(tier?.asyncRateLimitPerMinute ?? null),
    apiEndpointRateLimitPerMinute: formatOptionalNumber(
      tier?.apiEndpointRateLimitPerMinute ?? null
    ),
    canEditUsageLimit: tier?.canEditUsageLimit ?? false,
    canConfigureSso: tier?.canConfigureSso ?? false,
    logRetentionDays: formatOptionalNumber(tier?.logRetentionDays ?? null),
    workflowModelCostMultiplier: formatOptionalNumber(tier?.workflowModelCostMultiplier ?? null),
    functionExecutionDurationMultiplier: formatOptionalNumber(
      tier?.functionExecutionDurationMultiplier ?? null
    ),
    copilotCostMultiplier: formatOptionalNumber(tier?.copilotCostMultiplier ?? null),
    pricingFeatures: tier?.pricingFeatures.join('\n') ?? '',
    isPublic: tier?.isPublic ?? true,
    isDefault: tier?.isDefault ?? false,
    displayOrder: formatOptionalNumber(tier?.displayOrder ?? 0),
  })
}

function createBillingSettingsFormDefaults(snapshot: {
  onboardingAllowanceUsd: string
  overageThresholdDollars: string
  workflowExecutionChargeUsd: string
  functionExecutionChargeUsd: string
  usageWarningThresholdPercent: number
  freeTierUpgradeThresholdPercent: number
  enterpriseContactUrl: string | null
}): BillingSettingsFormDefaults {
  return {
    onboardingAllowanceUsd: snapshot.onboardingAllowanceUsd,
    overageThresholdDollars: snapshot.overageThresholdDollars,
    workflowExecutionChargeUsd: snapshot.workflowExecutionChargeUsd,
    functionExecutionChargeUsd: snapshot.functionExecutionChargeUsd,
    usageWarningThresholdPercent: snapshot.usageWarningThresholdPercent.toString(),
    freeTierUpgradeThresholdPercent: snapshot.freeTierUpgradeThresholdPercent.toString(),
    enterpriseContactUrl: snapshot.enterpriseContactUrl ?? '',
  }
}

function readRequiredText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim()
}

function readOptionalText(formData: FormData, key: string) {
  const value = readRequiredText(formData, key)
  return value.length > 0 ? value : null
}

function readOptionalNumber(formData: FormData, key: string) {
  const value = readRequiredText(formData, key)
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${key}`)
  }

  return parsed
}

function readOptionalInteger(formData: FormData, key: string) {
  const value = readOptionalNumber(formData, key)
  if (value === null) {
    return null
  }

  if (!Number.isInteger(value)) {
    throw new Error(`Invalid integer for ${key}`)
  }

  return value
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === 'on'
}

export function buildTierMutationInput(formData: FormData): AdminBillingTierMutationInput {
  const accessFields = normalizeTierAccessFields({
    ownerType: readRequiredText(
      formData,
      'ownerType'
    ) as AdminBillingTierMutationInput['ownerType'],
    usageScope: readRequiredText(
      formData,
      'usageScope'
    ) as AdminBillingTierMutationInput['usageScope'],
    seatMode: readRequiredText(formData, 'seatMode') as AdminBillingTierMutationInput['seatMode'],
  })

  return {
    displayName: readRequiredText(formData, 'displayName'),
    description: readRequiredText(formData, 'description'),
    status: readRequiredText(formData, 'status') as AdminBillingTierMutationInput['status'],
    ownerType: accessFields.ownerType,
    usageScope: accessFields.usageScope,
    seatMode: accessFields.seatMode,
    monthlyPriceUsd: readOptionalNumber(formData, 'monthlyPriceUsd'),
    yearlyPriceUsd: readOptionalNumber(formData, 'yearlyPriceUsd'),
    includedUsageLimitUsd: readOptionalNumber(formData, 'includedUsageLimitUsd'),
    storageLimitGb: readOptionalInteger(formData, 'storageLimitGb'),
    concurrencyLimit: readOptionalInteger(formData, 'concurrencyLimit'),
    seatCount: readOptionalInteger(formData, 'seatCount'),
    seatMaximum: readOptionalInteger(formData, 'seatMaximum'),
    stripeMonthlyPriceId: readOptionalText(formData, 'stripeMonthlyPriceId'),
    stripeYearlyPriceId: readOptionalText(formData, 'stripeYearlyPriceId'),
    stripeProductId: readOptionalText(formData, 'stripeProductId'),
    syncRateLimitPerMinute: readOptionalInteger(formData, 'syncRateLimitPerMinute'),
    asyncRateLimitPerMinute: readOptionalInteger(formData, 'asyncRateLimitPerMinute'),
    apiEndpointRateLimitPerMinute: readOptionalInteger(formData, 'apiEndpointRateLimitPerMinute'),
    canEditUsageLimit: readBoolean(formData, 'canEditUsageLimit'),
    canConfigureSso: readBoolean(formData, 'canConfigureSso'),
    logRetentionDays: readOptionalInteger(formData, 'logRetentionDays'),
    workflowModelCostMultiplier: readOptionalNumber(formData, 'workflowModelCostMultiplier'),
    functionExecutionDurationMultiplier: readOptionalNumber(
      formData,
      'functionExecutionDurationMultiplier'
    ),
    copilotCostMultiplier: readOptionalNumber(formData, 'copilotCostMultiplier'),
    pricingFeatures: readRequiredText(formData, 'pricingFeatures')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean),
    isPublic: readBoolean(formData, 'isPublic'),
    isDefault: readBoolean(formData, 'isDefault'),
    displayOrder: readOptionalInteger(formData, 'displayOrder') ?? 0,
  }
}

function buildBillingSettingsMutationInput(formData: FormData): AdminBillingSettingsMutationInput {
  return {
    onboardingAllowanceUsd: readOptionalNumber(formData, 'onboardingAllowanceUsd') ?? 0,
    overageThresholdDollars: readOptionalNumber(formData, 'overageThresholdDollars') ?? 0,
    workflowExecutionChargeUsd: readOptionalNumber(formData, 'workflowExecutionChargeUsd') ?? 0,
    functionExecutionChargeUsd: readOptionalNumber(formData, 'functionExecutionChargeUsd') ?? 0,
    usageWarningThresholdPercent:
      readOptionalInteger(formData, 'usageWarningThresholdPercent') ?? 80,
    freeTierUpgradeThresholdPercent:
      readOptionalInteger(formData, 'freeTierUpgradeThresholdPercent') ?? 90,
    enterpriseContactUrl: readOptionalText(formData, 'enterpriseContactUrl'),
  }
}

function formatMoney(value: number | null) {
  if (value === null) {
    return 'Custom'
  }

  if (value <= 0) {
    return 'Free'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatNullableNumber(value: number | null, suffix = '') {
  if (value === null) {
    return 'Custom'
  }

  return `${value}${suffix}`
}

function isFilled(value: string) {
  return value.trim().length > 0
}

function getOptionLabel(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
  fallback = value
) {
  return options.find((option) => option.value === value)?.label ?? fallback
}

function joinPreviewParts(parts: Array<string | null>) {
  return parts.filter(Boolean).join(' • ')
}

function formatMissingMessage(items: string[]) {
  return items.length === 0 ? null : `Missing: ${items.join(', ')}`
}

function formatCurrencyValue(value: string) {
  return isFilled(value) ? `$${value}` : null
}

function hasPositiveNumber(value: string) {
  if (!isFilled(value)) {
    return false
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

function getTierCommerceSummary(tier: AdminBillingTierSnapshot): string {
  const recurringPrice = Math.max(tier.monthlyPriceUsd ?? 0, tier.yearlyPriceUsd ?? 0)

  if (recurringPrice <= 0) {
    return 'Free'
  }

  if (tier.isPublic && (tier.stripeMonthlyPriceId || tier.stripeYearlyPriceId)) {
    return 'Self-serve'
  }

  return 'Contact sales'
}

function formatTierRecurringPrice(tier: AdminBillingTierSnapshot): string {
  if (tier.monthlyPriceUsd !== null && tier.monthlyPriceUsd > 0) {
    return formatMoney(tier.monthlyPriceUsd)
  }

  if (tier.yearlyPriceUsd !== null && tier.yearlyPriceUsd > 0) {
    return `${formatMoney(tier.yearlyPriceUsd)} / yr`
  }

  return getTierCommerceSummary(tier)
}

function countPricingFeatureLines(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean).length
}

function getTierSectionSummaries(
  defaults: TierFormDefaults
): Record<TierEditorSectionId, TierSectionSummary> {
  const featureCount = countPricingFeatureLines(defaults.pricingFeatures)
  const commerceLabel = getTierCommerceLabel(defaults)
  const generalMissing = [
    !isFilled(defaults.displayName) ? 'display name' : null,
    !isFilled(defaults.description) ? 'description' : null,
    defaults.isDefault && !defaults.isPublic ? 'default tier must be public' : null,
  ].filter((value): value is string => Boolean(value))

  const accessMissing = [
    defaults.isDefault &&
    (defaults.ownerType !== 'user' ||
      defaults.usageScope !== 'individual' ||
      defaults.seatMode !== 'fixed')
      ? 'default tier must be a public user plan with individual usage and fixed seats'
      : null,
    defaults.ownerType === 'user' && defaults.usageScope !== 'individual'
      ? 'User tiers must use individual usage'
      : null,
    defaults.ownerType === 'user' && defaults.seatMode !== 'fixed'
      ? 'User tiers cannot use adjustable seats'
      : null,
    defaults.ownerType === 'user' && defaults.canConfigureSso
      ? 'User tiers cannot configure SSO'
      : null,
    defaults.ownerType === 'organization' && !isFilled(defaults.seatCount)
      ? 'organization tiers must configure a seat count'
      : null,
    defaults.ownerType === 'organization' &&
    defaults.seatMode === 'fixed' &&
    isFilled(defaults.seatMaximum)
      ? 'fixed organization tiers cannot configure a maximum seat cap'
      : null,
  ].filter((value): value is string => Boolean(value))

  const pricingMissing = [
    defaults.isPublic &&
    hasPositiveNumber(defaults.monthlyPriceUsd) &&
    !isFilled(defaults.stripeMonthlyPriceId)
      ? 'monthly Stripe price'
      : null,
    defaults.isPublic &&
    hasPositiveNumber(defaults.yearlyPriceUsd) &&
    !isFilled(defaults.stripeYearlyPriceId)
      ? 'yearly Stripe price'
      : null,
    commerceLabel === 'free' &&
    (hasPositiveNumber(defaults.monthlyPriceUsd) || hasPositiveNumber(defaults.yearlyPriceUsd))
      ? 'free tiers cannot set recurring prices'
      : null,
  ].filter((value): value is string => Boolean(value))

  const seatsMissing =
    defaults.ownerType !== 'organization'
      ? []
      : [!isFilled(defaults.seatCount) ? 'seat count' : null].filter((value): value is string =>
          Boolean(value)
        )

  const seatRangeInvalid =
    isFilled(defaults.seatCount) &&
    isFilled(defaults.seatMaximum) &&
    Number(defaults.seatMaximum) < Number(defaults.seatCount)

  const configuredLimitCount = [
    defaults.includedUsageLimitUsd,
    defaults.storageLimitGb,
    defaults.concurrencyLimit,
    defaults.syncRateLimitPerMinute,
    defaults.asyncRateLimitPerMinute,
    defaults.apiEndpointRateLimitPerMinute,
    defaults.logRetentionDays,
  ].filter(isFilled).length
  const limitMissing = [
    defaults.status === 'active' && !isFilled(defaults.includedUsageLimitUsd)
      ? 'included usage'
      : null,
    defaults.status === 'active' && !isFilled(defaults.storageLimitGb) ? 'storage' : null,
    defaults.status === 'active' && !isFilled(defaults.concurrencyLimit) ? 'concurrency' : null,
    defaults.status === 'active' && !isFilled(defaults.syncRateLimitPerMinute) ? 'sync rate' : null,
    defaults.status === 'active' && !isFilled(defaults.asyncRateLimitPerMinute)
      ? 'async rate'
      : null,
    defaults.status === 'active' && !isFilled(defaults.apiEndpointRateLimitPerMinute)
      ? 'API rate'
      : null,
  ].filter((value): value is string => Boolean(value))

  const configuredMeteringCount = [
    defaults.workflowModelCostMultiplier,
    defaults.functionExecutionDurationMultiplier,
    defaults.copilotCostMultiplier,
  ].filter(isFilled).length
  const meteringMissing = [
    !isFilled(defaults.workflowModelCostMultiplier) ? 'workflow multiplier' : null,
    !isFilled(defaults.functionExecutionDurationMultiplier) ? 'function duration' : null,
    !isFilled(defaults.copilotCostMultiplier) ? 'copilot multiplier' : null,
  ].filter((value): value is string => Boolean(value))

  return {
    general: {
      preview: joinPreviewParts([
        isFilled(defaults.displayName) ? defaults.displayName : 'Untitled tier',
        getOptionLabel(TIER_STATUS_OPTIONS, defaults.status),
        defaults.isPublic ? 'Public' : 'Hidden',
        featureCount > 0 ? `${featureCount} pricing bullets` : 'No pricing bullets',
      ]),
      missing: formatMissingMessage(generalMissing),
      status: generalMissing.length === 0 ? 'ready' : 'review',
    },
    access: {
      preview: joinPreviewParts([
        `${getOptionLabel(TIER_OWNER_TYPE_OPTIONS, defaults.ownerType)} owner`,
        `${getOptionLabel(TIER_USAGE_SCOPE_OPTIONS, defaults.usageScope)} usage`,
        `${getOptionLabel(TIER_SEAT_MODE_OPTIONS, defaults.seatMode)} seat billing`,
        defaults.canEditUsageLimit ? 'Editable usage cap' : 'Fixed usage cap',
        defaults.canConfigureSso ? 'SSO on' : 'SSO off',
      ]),
      missing: formatMissingMessage(accessMissing),
      status: accessMissing.length === 0 ? 'ready' : 'review',
    },
    pricing: {
      preview: joinPreviewParts([
        commerceLabel === 'free'
          ? 'Free tier'
          : commerceLabel === 'contact-sales'
            ? 'Contact sales'
            : formatCurrencyValue(defaults.monthlyPriceUsd)
              ? `${formatCurrencyValue(defaults.monthlyPriceUsd)} monthly`
              : formatCurrencyValue(defaults.yearlyPriceUsd)
                ? `${formatCurrencyValue(defaults.yearlyPriceUsd)} yearly`
                : 'Price unset',
        formatCurrencyValue(defaults.yearlyPriceUsd)
          ? `${formatCurrencyValue(defaults.yearlyPriceUsd)} yearly`
          : null,
        `${
          [
            defaults.stripeMonthlyPriceId,
            defaults.stripeYearlyPriceId,
            defaults.stripeProductId,
          ].filter(isFilled).length
        }/3 Stripe links`,
      ]),
      missing: formatMissingMessage(pricingMissing),
      status:
        commerceLabel === 'free'
          ? pricingMissing.length === 0
            ? 'optional'
            : 'review'
          : pricingMissing.length === 0
            ? 'ready'
            : 'review',
    },
    seats: {
      preview:
        defaults.ownerType !== 'organization'
          ? 'User tiers do not manage organization seats'
          : defaults.seatMode === 'fixed'
            ? joinPreviewParts([
                isFilled(defaults.seatCount)
                  ? `${defaults.seatCount} fixed seats`
                  : 'Seat count unset',
                'No self-serve seat changes',
              ])
            : joinPreviewParts([
                isFilled(defaults.seatCount)
                  ? `${defaults.seatCount} base seats`
                  : 'Seat count unset',
                isFilled(defaults.seatMaximum)
                  ? `${defaults.seatMaximum} max seats`
                  : 'Unlimited seats',
              ]),
      missing: formatMissingMessage(
        seatRangeInvalid
          ? [...seatsMissing, 'seat maximum must stay above seat count']
          : seatsMissing
      ),
      status:
        defaults.ownerType !== 'organization'
          ? 'optional'
          : seatsMissing.length === 0 && !seatRangeInvalid
            ? 'ready'
            : 'review',
    },
    limits: {
      preview:
        configuredLimitCount === 0
          ? 'No included usage, storage, concurrency, rate, or retention limits configured'
          : joinPreviewParts([
              formatCurrencyValue(defaults.includedUsageLimitUsd)
                ? `${formatCurrencyValue(defaults.includedUsageLimitUsd)} included`
                : null,
              isFilled(defaults.storageLimitGb) ? `${defaults.storageLimitGb} GB storage` : null,
              isFilled(defaults.concurrencyLimit)
                ? `${defaults.concurrencyLimit} concurrent`
                : null,
              `${configuredLimitCount}/7 limits configured`,
            ]),
      missing: formatMissingMessage(limitMissing),
      status:
        defaults.status !== 'active' && configuredLimitCount === 0
          ? 'optional'
          : limitMissing.length === 0 && configuredLimitCount > 0
            ? 'ready'
            : 'review',
    },
    metering: {
      preview:
        configuredMeteringCount === 0
          ? 'Using base platform pricing only'
          : joinPreviewParts([
              isFilled(defaults.workflowModelCostMultiplier)
                ? `${defaults.workflowModelCostMultiplier}x workflow`
                : null,
              isFilled(defaults.functionExecutionDurationMultiplier)
                ? `$${defaults.functionExecutionDurationMultiplier}/s function`
                : null,
              isFilled(defaults.copilotCostMultiplier)
                ? `${defaults.copilotCostMultiplier}x copilot`
                : null,
            ]),
      missing: configuredMeteringCount === 0 ? formatMissingMessage(meteringMissing) : null,
      status: configuredMeteringCount === 0 ? 'optional' : 'ready',
    },
  }
}

export function createTierPreviewState(formData: FormData): TierFormDefaults {
  const accessFields = normalizeTierAccessFields({
    ownerType: (readRequiredText(formData, 'ownerType') || 'user') as TierFormDefaults['ownerType'],
    usageScope: (readRequiredText(formData, 'usageScope') ||
      'individual') as TierFormDefaults['usageScope'],
    seatMode: (readRequiredText(formData, 'seatMode') || 'fixed') as TierFormDefaults['seatMode'],
  })

  return normalizeTierFormDefaults({
    displayName: readRequiredText(formData, 'displayName'),
    description: readRequiredText(formData, 'description'),
    status: (readRequiredText(formData, 'status') || 'draft') as TierFormDefaults['status'],
    ownerType: accessFields.ownerType,
    usageScope: accessFields.usageScope,
    seatMode: accessFields.seatMode,
    monthlyPriceUsd: readRequiredText(formData, 'monthlyPriceUsd'),
    yearlyPriceUsd: readRequiredText(formData, 'yearlyPriceUsd'),
    includedUsageLimitUsd: readRequiredText(formData, 'includedUsageLimitUsd'),
    storageLimitGb: readRequiredText(formData, 'storageLimitGb'),
    concurrencyLimit: readRequiredText(formData, 'concurrencyLimit'),
    seatCount: readRequiredText(formData, 'seatCount'),
    seatMaximum: readRequiredText(formData, 'seatMaximum'),
    stripeMonthlyPriceId: readRequiredText(formData, 'stripeMonthlyPriceId'),
    stripeYearlyPriceId: readRequiredText(formData, 'stripeYearlyPriceId'),
    stripeProductId: readRequiredText(formData, 'stripeProductId'),
    syncRateLimitPerMinute: readRequiredText(formData, 'syncRateLimitPerMinute'),
    asyncRateLimitPerMinute: readRequiredText(formData, 'asyncRateLimitPerMinute'),
    apiEndpointRateLimitPerMinute: readRequiredText(formData, 'apiEndpointRateLimitPerMinute'),
    canEditUsageLimit: readBoolean(formData, 'canEditUsageLimit'),
    canConfigureSso: readBoolean(formData, 'canConfigureSso'),
    logRetentionDays: readRequiredText(formData, 'logRetentionDays'),
    workflowModelCostMultiplier: readRequiredText(formData, 'workflowModelCostMultiplier'),
    functionExecutionDurationMultiplier: readRequiredText(
      formData,
      'functionExecutionDurationMultiplier'
    ),
    copilotCostMultiplier: readRequiredText(formData, 'copilotCostMultiplier'),
    pricingFeatures: String(formData.get('pricingFeatures') ?? ''),
    isPublic: readBoolean(formData, 'isPublic'),
    isDefault: readBoolean(formData, 'isDefault'),
    displayOrder: readRequiredText(formData, 'displayOrder') || '0',
  })
}

function FieldHint({ children }: { children: string }) {
  return <p className='text-muted-foreground text-xs leading-relaxed'>{children}</p>
}

function OptionalFieldBadge() {
  return (
    <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
      Optional
    </Badge>
  )
}

function FieldShell({
  id,
  label,
  hint,
  nullable = false,
  blankHint,
  className,
  children,
}: {
  id: string
  label: string
  hint: string
  nullable?: boolean
  blankHint?: string
  className?: string
  children: ReactNode
}) {
  const resolvedHint = nullable ? [hint, blankHint ?? 'Leave blank to clear it.'].join(' ') : hint

  return (
    <div className={cn('space-y-2', className)}>
      <div className='flex min-h-6 items-center gap-2'>
        <Label htmlFor={id}>{label}</Label>
        {nullable ? <OptionalFieldBadge /> : null}
      </div>
      {children}
      <FieldHint>{resolvedHint}</FieldHint>
    </div>
  )
}

function TierFormSection({
  sectionId,
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  sectionId: TierEditorSectionId
  title: string
  summary: TierSectionSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <section id={`tier-section-${sectionId}`} className='border-border/60 border-b last:border-b-0'>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            className='flex h-auto w-full items-start justify-between gap-4 rounded-none px-4 py-4 text-left hover:bg-muted/30 sm:px-5'
          >
            <div className='min-w-0 flex-1 space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium text-sm'>{title}</span>
                <Badge
                  variant='outline'
                  className={cn(
                    ADMIN_STATUS_BADGE_CLASSNAME,
                    TIER_SECTION_STATUS_BADGE_CLASSNAME[summary.status]
                  )}
                >
                  {summary.status === 'ready'
                    ? 'Ready'
                    : summary.status === 'review'
                      ? 'Review'
                      : 'Optional'}
                </Badge>
              </div>
              <p className='max-w-3xl text-muted-foreground text-xs leading-relaxed'>
                {summary.preview}
              </p>
              {summary.missing ? (
                <p className='max-w-3xl text-[11px] text-muted-foreground/80 leading-relaxed'>
                  {summary.missing}
                </p>
              ) : null}
            </div>
            <div className='flex items-center pt-0.5'>
              {open ? (
                <ChevronDown className='h-4 w-4 text-muted-foreground' />
              ) : (
                <ChevronRight className='h-4 w-4 text-muted-foreground' />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='border-border/60 border-t bg-muted/10 px-4 py-4 sm:px-5'>
          {children}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  value,
  onValueChange,
  options,
  hint,
  disabled = false,
  className,
  triggerClassName,
}: {
  id: string
  name?: string
  label: string
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  hint: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
}) {
  const selectProps =
    value !== undefined
      ? { value, onValueChange }
      : {
          defaultValue,
        }

  return (
    <FieldShell id={id} label={label} hint={hint} className={className}>
      <Select name={name} disabled={disabled} {...selectProps}>
        <SelectTrigger id={id} className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

function SwitchField({
  id,
  name,
  label,
  defaultChecked,
  hint,
}: {
  id: string
  name: string
  label: string
  defaultChecked: boolean
  hint?: string
}) {
  return (
    <div className='flex items-start justify-between gap-4 rounded-md border border-border/60 bg-muted/20 px-3 py-3'>
      <div className='space-y-1'>
        <Label htmlFor={id} className='font-medium text-sm'>
          {label}
        </Label>
        {hint ? <FieldHint>{hint}</FieldHint> : null}
      </div>
      <Switch id={id} name={name} defaultChecked={defaultChecked} />
    </div>
  )
}

function TierFormFields({
  initialValues,
  previewValues,
  sectionState,
  onSectionStateChange,
  onAccessFieldChange,
}: {
  initialValues: TierFormDefaults
  previewValues: TierFormDefaults
  sectionState: TierEditorSectionState
  onSectionStateChange: (sectionId: TierEditorSectionId, open: boolean) => void
  onAccessFieldChange: (field: keyof TierDerivedAccessFields, value: string) => void
}) {
  const sectionSummaries = getTierSectionSummaries(previewValues)
  const derivedAccessFields = normalizeTierAccessFields(previewValues)

  return (
    <div>
      <TierFormSection
        sectionId='general'
        title='General Info'
        summary={sectionSummaries.general}
        open={sectionState.general}
        onOpenChange={(open) => onSectionStateChange('general', open)}
      >
        <div className='space-y-4'>
          <div className='space-y-3'>
            <FieldHint>Control whether this tier is public and used by default.</FieldHint>
            <div className='grid gap-3 md:grid-cols-2'>
              <SwitchField
                id='isPublic'
                name='isPublic'
                label='Public tier'
                defaultChecked={initialValues.isPublic}
              />
              <SwitchField
                id='isDefault'
                name='isDefault'
                label='Default tier'
                defaultChecked={initialValues.isDefault}
              />
            </div>
            <FieldHint>
              Default tiers must stay public, free, and user-owned. Billing can only be enabled once
              the default tier is active.
            </FieldHint>
          </div>

          <div className='grid gap-3 md:grid-cols-12'>
            <FieldShell
              id='displayName'
              label='Display Name'
              hint='Shown in billing and pricing.'
              className='md:col-span-7'
            >
              <Input
                id='displayName'
                name='displayName'
                defaultValue={initialValues.displayName}
                className='h-9'
                required
              />
            </FieldShell>
            <FieldShell
              id='status'
              label='Status'
              hint='Draft is internal. Active is live. Archived blocks new sales.'
              className='md:col-span-3'
            >
              <Select name='status' defaultValue={initialValues.status}>
                <SelectTrigger id='status' className='h-9'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>
            <FieldShell
              id='displayOrder'
              label='Display Order'
              hint='Lower numbers show first.'
              className='md:col-span-2'
            >
              <Input
                id='displayOrder'
                name='displayOrder'
                type='number'
                defaultValue={initialValues.displayOrder}
                className='h-9'
              />
            </FieldShell>
          </div>

          <div className='grid gap-3 md:grid-cols-2'>
            <FieldShell
              id='description'
              label='Description'
              hint='Short description shown in billing.'
            >
              <Textarea
                id='description'
                name='description'
                defaultValue={initialValues.description}
                rows={3}
                className='min-h-[112px]'
                required
              />
            </FieldShell>
            <FieldShell id='pricingFeatures' label='Pricing Features' hint='One feature per line.'>
              <Textarea
                id='pricingFeatures'
                name='pricingFeatures'
                defaultValue={initialValues.pricingFeatures}
                rows={3}
                className='min-h-[112px]'
              />
            </FieldShell>
          </div>
        </div>
      </TierFormSection>

      <TierFormSection
        sectionId='pricing'
        title='Pricing And Checkout'
        summary={sectionSummaries.pricing}
        open={sectionState.pricing}
        onOpenChange={(open) => onSectionStateChange('pricing', open)}
      >
        <div className='space-y-4'>
          <div className='grid gap-4 xl:grid-cols-2'>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Monthly Checkout</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Set the monthly price and Stripe ID.
                </p>
              </div>
              <FieldShell
                id='monthlyPriceUsd'
                label='Monthly Price USD'
                hint='Monthly base price.'
                nullable
                blankHint='Leave blank for free or contact-sales tiers.'
              >
                <Input
                  id='monthlyPriceUsd'
                  name='monthlyPriceUsd'
                  type='number'
                  step='0.01'
                  defaultValue={initialValues.monthlyPriceUsd}
                />
              </FieldShell>
              <FieldShell
                id='stripeMonthlyPriceId'
                label='Stripe Monthly Price ID'
                hint='Stripe monthly price ID, like `price_...`.'
                nullable
                blankHint='Leave blank if monthly checkout is off.'
              >
                <Input
                  id='stripeMonthlyPriceId'
                  name='stripeMonthlyPriceId'
                  defaultValue={initialValues.stripeMonthlyPriceId}
                />
              </FieldShell>
            </div>

            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Yearly Checkout</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Set the yearly price and Stripe ID.
                </p>
              </div>
              <FieldShell
                id='yearlyPriceUsd'
                label='Yearly Price USD'
                hint='Yearly price.'
                nullable
                blankHint='Leave blank if yearly billing is off.'
              >
                <Input
                  id='yearlyPriceUsd'
                  name='yearlyPriceUsd'
                  type='number'
                  step='0.01'
                  defaultValue={initialValues.yearlyPriceUsd}
                />
              </FieldShell>
              <FieldShell
                id='stripeYearlyPriceId'
                label='Stripe Yearly Price ID'
                hint='Stripe yearly price ID, like `price_...`.'
                nullable
                blankHint='Leave blank if yearly billing is off.'
              >
                <Input
                  id='stripeYearlyPriceId'
                  name='stripeYearlyPriceId'
                  defaultValue={initialValues.stripeYearlyPriceId}
                />
              </FieldShell>
            </div>
          </div>

          <div className='rounded-md border border-border/60 bg-background px-4 py-4'>
            <FieldShell
              id='stripeProductId'
              label='Stripe Product ID'
              hint='Stripe product ID, like `prod_...`.'
              nullable
              blankHint='Leave blank if unused.'
            >
              <Input
                id='stripeProductId'
                name='stripeProductId'
                defaultValue={initialValues.stripeProductId}
              />
            </FieldShell>
          </div>
        </div>
      </TierFormSection>

      <TierFormSection
        sectionId='access'
        title='Access Model'
        summary={sectionSummaries.access}
        open={sectionState.access}
        onOpenChange={(open) => onSectionStateChange('access', open)}
      >
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          <SelectField
            id='ownerType'
            name='ownerType'
            label='Owner Type'
            value={derivedAccessFields.ownerType}
            options={TIER_OWNER_TYPE_OPTIONS}
            hint='Choose user or organization.'
            onValueChange={(value) => onAccessFieldChange('ownerType', value)}
          />
          <SelectField
            id='usageScope'
            name='usageScope'
            label='Usage Scope'
            value={derivedAccessFields.usageScope}
            options={TIER_USAGE_SCOPE_OPTIONS}
            hint='Track usage per account or pooled.'
            disabled={derivedAccessFields.ownerType === 'user'}
            onValueChange={(value) => onAccessFieldChange('usageScope', value)}
          />
          <SelectField
            id='seatMode'
            name='seatMode'
            label='Seat Mode'
            value={derivedAccessFields.seatMode}
            options={TIER_SEAT_MODE_OPTIONS}
            hint='Use a fixed seat count or let it change.'
            disabled={derivedAccessFields.ownerType === 'user'}
            onValueChange={(value) => onAccessFieldChange('seatMode', value)}
          />
          <SwitchField
            id='canEditUsageLimit'
            name='canEditUsageLimit'
            label='Can edit usage limit'
            defaultChecked={initialValues.canEditUsageLimit}
            hint='Allow usage limit changes.'
          />
          <SwitchField
            id='canConfigureSso'
            name='canConfigureSso'
            label='Can configure SSO'
            defaultChecked={initialValues.canConfigureSso}
            hint='Allow SSO setup.'
          />
        </div>
      </TierFormSection>

      {derivedAccessFields.ownerType === 'organization' ? (
        <TierFormSection
          sectionId='seats'
          title='Seats'
          summary={sectionSummaries.seats}
          open={sectionState.seats}
          onOpenChange={(open) => onSectionStateChange('seats', open)}
        >
          <div className='grid gap-4 md:grid-cols-2'>
            <FieldShell id='seatCount' label='Seat Count' hint='Licensed seats or starting seats.'>
              <Input
                id='seatCount'
                name='seatCount'
                type='number'
                defaultValue={initialValues.seatCount}
              />
            </FieldShell>
            <FieldShell
              id='seatMaximum'
              label='Maximum Seats'
              hint='Seat cap for adjustable tiers.'
              nullable
              blankHint='Leave blank for no cap.'
            >
              <Input
                id='seatMaximum'
                name='seatMaximum'
                type='number'
                defaultValue={initialValues.seatMaximum}
                disabled={derivedAccessFields.seatMode !== 'adjustable'}
              />
            </FieldShell>
          </div>
        </TierFormSection>
      ) : null}

      <TierFormSection
        sectionId='limits'
        title='Capacity And Limits'
        summary={sectionSummaries.limits}
        open={sectionState.limits}
        onOpenChange={(open) => onSectionStateChange('limits', open)}
      >
        <div className='space-y-4'>
          <div className='grid gap-4 xl:grid-cols-2'>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Allowance And Retention</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Set usage, storage, and log retention.
                </p>
              </div>
              <div className='grid gap-4'>
                <FieldShell
                  id='includedUsageLimitUsd'
                  label='Included Usage USD'
                  hint='Monthly included usage.'
                  nullable
                  blankHint='Leave blank while drafting.'
                >
                  <Input
                    id='includedUsageLimitUsd'
                    name='includedUsageLimitUsd'
                    type='number'
                    step='0.01'
                    defaultValue={initialValues.includedUsageLimitUsd}
                  />
                </FieldShell>
                <FieldShell
                  id='storageLimitGb'
                  label='Storage Limit GB'
                  hint='Storage limit in GB.'
                  nullable
                  blankHint='Leave blank while drafting.'
                >
                  <Input
                    id='storageLimitGb'
                    name='storageLimitGb'
                    type='number'
                    defaultValue={initialValues.storageLimitGb}
                  />
                </FieldShell>
                <FieldShell
                  id='logRetentionDays'
                  label='Log Retention Days'
                  hint='How long logs stay available.'
                  nullable
                  blankHint='Leave blank for unlimited.'
                >
                  <Input
                    id='logRetentionDays'
                    name='logRetentionDays'
                    type='number'
                    defaultValue={initialValues.logRetentionDays}
                  />
                </FieldShell>
              </div>
            </div>

            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Execution Throughput</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Set concurrency and per-minute limits.
                </p>
              </div>
              <FieldShell
                id='concurrencyLimit'
                label='Max Concurrent Executions'
                hint='Max parallel executions.'
                nullable
                blankHint='Leave blank while drafting.'
              >
                <Input
                  id='concurrencyLimit'
                  name='concurrencyLimit'
                  type='number'
                  defaultValue={initialValues.concurrencyLimit}
                />
              </FieldShell>
              <div className='grid gap-4 md:grid-cols-2'>
                <FieldShell
                  id='syncRateLimitPerMinute'
                  label='Sync Executions / Min'
                  hint='Per-minute sync execution limit.'
                  nullable
                  blankHint='Leave blank while drafting.'
                >
                  <Input
                    id='syncRateLimitPerMinute'
                    name='syncRateLimitPerMinute'
                    type='number'
                    defaultValue={initialValues.syncRateLimitPerMinute}
                  />
                </FieldShell>
                <FieldShell
                  id='asyncRateLimitPerMinute'
                  label='Async Executions / Min'
                  hint='Per-minute async execution limit.'
                  nullable
                  blankHint='Leave blank while drafting.'
                >
                  <Input
                    id='asyncRateLimitPerMinute'
                    name='asyncRateLimitPerMinute'
                    type='number'
                    defaultValue={initialValues.asyncRateLimitPerMinute}
                  />
                </FieldShell>
              </div>
              <FieldShell
                id='apiEndpointRateLimitPerMinute'
                label='API Requests / Min'
                hint='Per-minute API request limit.'
                nullable
                blankHint='Leave blank while drafting.'
              >
                <Input
                  id='apiEndpointRateLimitPerMinute'
                  name='apiEndpointRateLimitPerMinute'
                  type='number'
                  defaultValue={initialValues.apiEndpointRateLimitPerMinute}
                />
              </FieldShell>
            </div>
          </div>
        </div>
      </TierFormSection>

      <TierFormSection
        sectionId='metering'
        title='Metering'
        summary={sectionSummaries.metering}
        open={sectionState.metering}
        onOpenChange={(open) => onSectionStateChange('metering', open)}
      >
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          <FieldShell
            id='workflowModelCostMultiplier'
            label='Workflow Model Cost Multiplier'
            hint='Workflow cost multiplier.'
            nullable
            blankHint='Leave blank for the default 1x.'
          >
            <Input
              id='workflowModelCostMultiplier'
              name='workflowModelCostMultiplier'
              type='number'
              step='0.01'
              defaultValue={initialValues.workflowModelCostMultiplier}
            />
          </FieldShell>
          <FieldShell
            id='functionExecutionDurationMultiplier'
            label='Function Duration Multiplier'
            hint='Extra USD per second.'
            nullable
            blankHint='Leave blank for the default rate.'
          >
            <Input
              id='functionExecutionDurationMultiplier'
              name='functionExecutionDurationMultiplier'
              type='number'
              step='0.0001'
              defaultValue={initialValues.functionExecutionDurationMultiplier}
            />
          </FieldShell>
          <FieldShell
            id='copilotCostMultiplier'
            label='Copilot Cost Multiplier'
            hint='Copilot cost multiplier.'
            nullable
            blankHint='Leave blank for the default 1x.'
          >
            <Input
              id='copilotCostMultiplier'
              name='copilotCostMultiplier'
              type='number'
              step='0.01'
              defaultValue={initialValues.copilotCostMultiplier}
            />
          </FieldShell>
        </div>
      </TierFormSection>
    </div>
  )
}

export function TierEditorHeaderCenter({
  previewValues,
  extraStats = [],
}: {
  previewValues: TierFormDefaults
  extraStats?: Array<{ label: string; value: string }>
}) {
  const summaries = getTierSectionSummaries(previewValues)
  const visibleSectionSummaries = (
    normalizeTierAccessFields(previewValues).ownerType === 'organization'
      ? Object.entries(summaries)
      : Object.entries(summaries).filter(([sectionId]) => sectionId !== 'seats')
  ).map(([, summary]) => summary)
  const readyCount = visibleSectionSummaries.filter((summary) => summary.status === 'ready').length
  const reviewCount = visibleSectionSummaries.filter(
    (summary) => summary.status === 'review'
  ).length
  const optionalCount = visibleSectionSummaries.filter(
    (summary) => summary.status === 'optional'
  ).length
  const stats = [
    { label: 'Ready', value: String(readyCount) },
    { label: 'Review', value: String(reviewCount) },
    { label: 'Optional', value: String(optionalCount) },
    ...extraStats,
  ]

  return (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      {stats.map((stat) => (
        <div key={stat.label} className='flex items-baseline gap-1 whitespace-nowrap'>
          <span className='text-[11px] text-muted-foreground'>{stat.label}</span>
          <span className='font-medium text-[11px] text-foreground'>{stat.value}</span>
        </div>
      ))}
    </div>
  )
}

export function TierEditorFormSurface({
  formId,
  initialValues,
  previewValues,
  sectionState,
  onSectionStateChange,
  onAccessFieldChange,
  disabled,
  onSubmit,
  onFormChange,
  footer,
}: {
  formId: string
  initialValues: TierFormDefaults
  previewValues: TierFormDefaults
  sectionState: TierEditorSectionState
  onSectionStateChange: (sectionId: TierEditorSectionId, open: boolean) => void
  onAccessFieldChange: (field: keyof TierDerivedAccessFields, value: string) => void
  disabled: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  onFormChange: (event: FormEvent<HTMLFormElement>) => void
  footer?: ReactNode
}) {
  return (
    <div className='overflow-hidden rounded-lg border border-border bg-background'>
      <form id={formId} onSubmit={onSubmit} onChange={onFormChange}>
        <fieldset disabled={disabled}>
          <TierFormFields
            initialValues={initialValues}
            previewValues={previewValues}
            sectionState={sectionState}
            onSectionStateChange={onSectionStateChange}
            onAccessFieldChange={onAccessFieldChange}
          />
          {footer ? (
            <div className='border-border/60 border-t px-4 py-4 sm:px-5'>{footer}</div>
          ) : null}
        </fieldset>
      </form>
    </div>
  )
}

function BillingTierOverviewCard({ tier }: { tier: AdminBillingTierSnapshot }) {
  return (
    <Link href={`/admin/billing/${tier.id}`} className='block h-full'>
      <div className='group flex h-full cursor-pointer flex-col gap-3 rounded-md border bg-card/40 p-4 transition-colors hover:bg-card'>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0 space-y-1'>
            <div className='flex items-center gap-2'>
              <Receipt className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
              <h3 className='truncate font-medium text-sm leading-tight'>{tier.displayName}</h3>
            </div>
            <div className='flex flex-wrap items-center gap-1.5'>
              <Badge variant='secondary' className={ADMIN_META_BADGE_CLASSNAME}>
                {tier.status}
              </Badge>
              <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                {tier.isPublic ? 'public' : 'hidden'}
              </Badge>
              {tier.isDefault ? (
                <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                  default
                </Badge>
              ) : null}
            </div>
          </div>
          <Badge variant='secondary' className={ADMIN_META_BADGE_CLASSNAME}>
            {tier.subscriptionCount} subscriptions
          </Badge>
        </div>

        <div className='flex flex-col gap-2 text-muted-foreground text-xs'>
          <div className='flex flex-wrap items-center gap-2'>
            <span>{getTierCommerceSummary(tier)}</span>
            <span>•</span>
            <span>{tier.ownerType === 'organization' ? 'Organization owner' : 'User owner'}</span>
            <span>•</span>
            <span>{tier.usageScope === 'pooled' ? 'Pooled usage' : 'Individual usage'}</span>
            <span>•</span>
            <span>{tier.seatMode === 'adjustable' ? 'Adjustable seats' : 'Fixed seats'}</span>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <span>{formatTierRecurringPrice(tier)}</span>
            <span>•</span>
            <span>{formatNullableNumber(tier.includedUsageLimitUsd, ' USD included')}</span>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <span>{formatNullableNumber(tier.storageLimitGb, ' GB storage')}</span>
            <span>•</span>
            <span>{formatNullableNumber(tier.concurrencyLimit, ' concurrent')}</span>
          </div>
        </div>

        <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
          {tier.description}
        </p>
      </div>
    </Link>
  )
}

function BillingSettingsCard({
  snapshot,
}: {
  snapshot: {
    billingEnabled: boolean
    onboardingAllowanceUsd: string
    overageThresholdDollars: string
    workflowExecutionChargeUsd: string
    functionExecutionChargeUsd: string
    usageWarningThresholdPercent: number
    freeTierUpgradeThresholdPercent: number
    enterpriseContactUrl: string | null
  }
}) {
  const updateSettings = useUpdateAdminBillingSettings()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const defaults = createBillingSettingsFormDefaults(snapshot)

  useEffect(() => {
    if (!message) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null)
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [message])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    try {
      const input = buildBillingSettingsMutationInput(new FormData(event.currentTarget))
      await updateSettings.mutateAsync(input)
      setMessage('Billing settings updated')
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    }
  }

  return (
    <Card className='overflow-hidden rounded-lg border border-border bg-muted/10'>
      <CardHeader className='border-border/60 border-b bg-muted/10 px-4 py-4 sm:px-5'>
        <CardTitle className='text-sm'>Global Billing Settings</CardTitle>
        <CardDescription>
          Manage platform-wide billing defaults, charges, and threshold behavior.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 bg-muted/10 px-4 py-4 sm:px-5'>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <fieldset disabled={updateSettings.isPending} className='space-y-4'>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Thresholds And Messaging</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Defaults for onboarding credit, billing thresholds, and upgrade prompts.
                </p>
              </div>
              <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
                <FieldShell
                  id='onboardingAllowanceUsd'
                  label='Onboarding Allowance USD'
                  hint='One-time credit for new users.'
                >
                  <Input
                    id='onboardingAllowanceUsd'
                    name='onboardingAllowanceUsd'
                    type='number'
                    step='0.01'
                    defaultValue={defaults.onboardingAllowanceUsd}
                  />
                </FieldShell>
                <FieldShell
                  id='overageThresholdDollars'
                  label='Overage Threshold USD'
                  hint='Create overage billing after this amount.'
                >
                  <Input
                    id='overageThresholdDollars'
                    name='overageThresholdDollars'
                    type='number'
                    step='0.01'
                    defaultValue={defaults.overageThresholdDollars}
                  />
                </FieldShell>
                <FieldShell
                  id='usageWarningThresholdPercent'
                  label='Usage Warning %'
                  hint='Warn at this usage percent.'
                >
                  <Input
                    id='usageWarningThresholdPercent'
                    name='usageWarningThresholdPercent'
                    type='number'
                    defaultValue={defaults.usageWarningThresholdPercent}
                  />
                </FieldShell>
                <FieldShell
                  id='freeTierUpgradeThresholdPercent'
                  label='Free Tier Upgrade %'
                  hint='Show stronger upgrade prompts at this percent.'
                >
                  <Input
                    id='freeTierUpgradeThresholdPercent'
                    name='freeTierUpgradeThresholdPercent'
                    type='number'
                    defaultValue={defaults.freeTierUpgradeThresholdPercent}
                  />
                </FieldShell>
              </div>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                <div className='space-y-1'>
                  <p className='font-medium text-sm'>Base Charges</p>
                  <p className='text-muted-foreground text-xs leading-relaxed'>
                    Platform charges applied before tier-specific multipliers.
                  </p>
                </div>
                <div className='grid gap-4 md:grid-cols-2'>
                  <FieldShell
                    id='workflowExecutionChargeUsd'
                    label='Workflow Base Charge USD'
                    hint='Base charge for each workflow run.'
                  >
                    <Input
                      id='workflowExecutionChargeUsd'
                      name='workflowExecutionChargeUsd'
                      type='number'
                      step='0.0001'
                      defaultValue={defaults.workflowExecutionChargeUsd}
                    />
                  </FieldShell>
                  <FieldShell
                    id='functionExecutionChargeUsd'
                    label='Function Base Charge USD'
                    hint='Base charge for each function run.'
                  >
                    <Input
                      id='functionExecutionChargeUsd'
                      name='functionExecutionChargeUsd'
                      type='number'
                      step='0.0001'
                      defaultValue={defaults.functionExecutionChargeUsd}
                    />
                  </FieldShell>
                </div>
              </div>

              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                <div className='space-y-1'>
                  <p className='font-medium text-sm'>Enterprise Contact</p>
                  <p className='text-muted-foreground text-xs leading-relaxed'>
                    Contact link used in billing surfaces and enterprise upgrade flows.
                  </p>
                </div>
                <FieldShell
                  id='enterpriseContactUrl'
                  label='Enterprise Contact URL'
                  hint='Link used for enterprise contact.'
                  nullable
                  blankHint='Leave blank to remove it.'
                >
                  <Input
                    id='enterpriseContactUrl'
                    name='enterpriseContactUrl'
                    defaultValue={defaults.enterpriseContactUrl}
                  />
                </FieldShell>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Manage registration, billing activation, promotion codes, and Stripe secrets from
                  the system settings section on the main admin page.
                </p>
              </div>
            </div>

            {error ? (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {message ? (
              <Notice variant='success' title='Saved'>
                {message}
              </Notice>
            ) : null}
            <PrimaryButton type='submit' disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving…' : 'Save Billing Settings'}
            </PrimaryButton>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}

export function AdminBilling() {
  const snapshotQuery = useAdminBillingSnapshot()
  const snapshot = snapshotQuery.data
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredTiers = useMemo(() => {
    if (!snapshot) {
      return []
    }

    const normalizedSearchQuery = searchQuery.trim().toLowerCase()
    if (!normalizedSearchQuery) {
      return snapshot.currentTiers
    }

    return snapshot.currentTiers.filter((tier) =>
      [tier.displayName, tier.description, tier.id].some((value) =>
        value.toLowerCase().includes(normalizedSearchQuery)
      )
    )
  }, [searchQuery, snapshot])

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <BillingBreadcrumbs items={[{ label: 'Admin', href: '/admin' }, { label: 'Billing' }]} />
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder='Search tiers...'
          className='w-full'
        />
      </div>
    </div>
  )

  const headerRight = (
    <PrimaryButton onClick={() => router.push('/admin/billing/create')}>
      <Plus className='h-3.5 w-3.5' />
      <span>Create tier</span>
    </PrimaryButton>
  )

  const defaultTier = snapshot?.currentTiers.find((tier) => tier.isDefault) ?? null
  const publicTierCount = snapshot?.currentTiers.filter((tier) => tier.isPublic).length ?? 0

  const headerCenter = snapshot ? (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Billing</span>
        <span className='font-medium text-[11px] text-foreground'>
          {snapshot.billingEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Tiers</span>
        <span className='font-medium text-[11px] text-foreground'>
          {snapshot.currentTiers.length}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Public</span>
        <span className='font-medium text-[11px] text-foreground'>{publicTierCount}</span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Default</span>
        <span className='max-w-[140px] truncate font-medium text-[11px] text-foreground'>
          {defaultTier?.displayName ?? 'Not set'}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>Base</span>
        <span className='font-medium text-[11px] text-foreground'>
          W ${snapshot.workflowExecutionChargeUsd} • F ${snapshot.functionExecutionChargeUsd}
        </span>
      </div>
    </div>
  ) : null

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(snapshotQuery.error)}</AlertDescription>
          </Alert>
        ) : null}

        {snapshotQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>Loading billing inventory...</p>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <BillingSettingsCard snapshot={snapshot} />

            <div className='space-y-1'>
              <h2 className='font-medium text-sm'>Current tiers</h2>
              <p className='text-muted-foreground text-sm'>
                Open a tier to update pricing, availability, customer limits, and included usage.
              </p>
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {snapshot.currentTiers.length === 0 ? (
                <EmptyStateCard
                  title='Create your first billing tier'
                  description='Set up the first plan customers can purchase and manage.'
                  buttonText='Create Tier'
                  onClick={() => router.push('/admin/billing/create')}
                  icon={<Receipt className='h-4 w-4 text-muted-foreground' />}
                />
              ) : filteredTiers.length === 0 ? (
                <div className='col-span-full py-12 text-center'>
                  <p className='text-muted-foreground text-sm'>
                    No tiers match your search. Clear the search to see the current catalog.
                  </p>
                </div>
              ) : (
                filteredTiers.map((tier) => <BillingTierOverviewCard key={tier.id} tier={tier} />)
              )}
            </div>
          </>
        ) : null}
      </div>
    </AdminPageShell>
  )
}

export function AdminBillingCreateTier() {
  const router = useRouter()
  const createTier = useCreateAdminBillingTier()
  const [error, setError] = useState<string | null>(null)
  const initialValues = useMemo(() => createTierFormDefaults(), [])
  const [previewValues, setPreviewValues] = useState<TierFormDefaults>(initialValues)
  const [sectionState, setSectionState] = useState<TierEditorSectionState>({
    ...DEFAULT_TIER_EDITOR_SECTIONS,
  })
  const formId = 'admin-billing-create-tier-form'

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <BillingBreadcrumbs
        items={[
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Create tier' },
        ]}
      />
    </div>
  )

  const headerCenter = <TierEditorHeaderCenter previewValues={previewValues} />

  const headerRight = (
    <PrimaryButton form={formId} type='submit' disabled={createTier.isPending}>
      {createTier.isPending ? 'Creating…' : 'Create Draft Tier'}
    </PrimaryButton>
  )

  function handleFormChange(event: FormEvent<HTMLFormElement>) {
    setError(null)
    setPreviewValues(createTierPreviewState(new FormData(event.currentTarget)))
  }

  function handleAccessFieldChange(field: keyof TierDerivedAccessFields, value: string) {
    setError(null)
    setPreviewValues((current) =>
      normalizeTierFormDefaults({
        ...current,
        [field]: value,
      } as TierFormDefaults)
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    try {
      const input = buildTierMutationInput(new FormData(event.currentTarget))
      const result = await createTier.mutateAsync(input)
      const tierId =
        result && typeof result === 'object' && 'id' in result ? String(result.id) : null

      if (!tierId) {
        throw new Error('Created tier response did not include a tier id')
      }

      router.push(`/admin/billing/${tierId}`)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    }
  }

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <TierEditorFormSurface
          formId={formId}
          initialValues={initialValues}
          previewValues={previewValues}
          sectionState={sectionState}
          onSectionStateChange={(sectionId, open) =>
            setSectionState((current) => ({ ...current, [sectionId]: open }))
          }
          onAccessFieldChange={handleAccessFieldChange}
          disabled={createTier.isPending}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
        />
      </div>
    </AdminPageShell>
  )
}
