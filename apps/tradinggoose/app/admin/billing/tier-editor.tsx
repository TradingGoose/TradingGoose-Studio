'use client'

import type { FormEvent, ReactNode } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import type { Messages } from 'next-intl'
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@/components/ui'

type AdminMessages = Messages['admin']

import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { cn } from '@/lib/utils'
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { formatUsd } from '@/i18n/formatters'
import { Link } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'

export type AdminBillingCopy = AdminMessages['billing']

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
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
  accessCode: string
  workflowExecutionTimeLimitSeconds: string
  syncRateLimitPerMinute: string
  asyncRateLimitPerMinute: string
  apiEndpointRateLimitPerMinute: string
  maxPendingAgeSeconds: string
  maxPendingCount: string
  canEditUsageLimit: boolean
  canConfigureSso: boolean
  logRetentionDays: string
  workflowExecutionMultiplier: string
  workflowModelCostMultiplier: string
  functionExecutionMultiplier: string
  copilotCostMultiplier: string
  pricingFeatures: string
  isPublic: boolean
  isDefault: boolean
  displayOrder: string
}

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

const getTierStatusOptions = (copy: AdminBillingCopy) =>
  [
    { value: 'draft', label: copy.status.draft },
    { value: 'active', label: copy.status.active },
    { value: 'archived', label: copy.status.archived },
  ] as const

const getTierOwnerTypeOptions = (copy: AdminBillingCopy) =>
  [
    { value: 'user', label: copy.ownerTypes.user },
    { value: 'organization', label: copy.ownerTypes.organization },
  ] as const

const getTierUsageScopeOptions = (copy: AdminBillingCopy) =>
  [
    { value: 'individual', label: copy.usageScopes.individual },
    { value: 'pooled', label: copy.usageScopes.pooled },
  ] as const

const getTierSeatModeOptions = (copy: AdminBillingCopy) =>
  [
    { value: 'fixed', label: copy.seatModes.fixed },
    { value: 'adjustable', label: copy.seatModes.adjustable },
  ] as const

export function getBillingStatusLabel(
  copy: AdminBillingCopy,
  status: AdminBillingTierSnapshot['status'] | TierFormDefaults['status']
) {
  switch (status) {
    case 'draft':
      return copy.status.draft
    case 'active':
      return copy.status.active
    case 'archived':
      return copy.status.archived
    default:
      return status
  }
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
  stripeMonthlyPriceId: string
  stripeYearlyPriceId: string
}): TierCommerceLabel {
  const hasMonthlyPrice = hasPositiveNumber(defaults.monthlyPriceUsd)
  const hasYearlyPrice = hasPositiveNumber(defaults.yearlyPriceUsd)

  if (!hasMonthlyPrice && !hasYearlyPrice) {
    return 'free'
  }

  if (isFilled(defaults.stripeMonthlyPriceId) || isFilled(defaults.stripeYearlyPriceId)) {
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
    accessCode: tier?.accessCode ?? '',
    workflowExecutionTimeLimitSeconds: formatOptionalNumber(
      tier?.workflowExecutionTimeLimitSeconds ?? null
    ),
    syncRateLimitPerMinute: formatOptionalNumber(tier?.syncRateLimitPerMinute ?? null),
    asyncRateLimitPerMinute: formatOptionalNumber(tier?.asyncRateLimitPerMinute ?? null),
    apiEndpointRateLimitPerMinute: formatOptionalNumber(
      tier?.apiEndpointRateLimitPerMinute ?? null
    ),
    maxPendingAgeSeconds: formatOptionalNumber(tier?.maxPendingAgeSeconds ?? null),
    maxPendingCount: formatOptionalNumber(tier?.maxPendingCount ?? null),
    canEditUsageLimit: tier?.canEditUsageLimit ?? false,
    canConfigureSso: tier?.canConfigureSso ?? false,
    logRetentionDays: formatOptionalNumber(tier?.logRetentionDays ?? null),
    workflowExecutionMultiplier: formatOptionalNumber(tier?.workflowExecutionMultiplier ?? null),
    workflowModelCostMultiplier: formatOptionalNumber(tier?.workflowModelCostMultiplier ?? null),
    functionExecutionMultiplier: formatOptionalNumber(tier?.functionExecutionMultiplier ?? null),
    copilotCostMultiplier: formatOptionalNumber(tier?.copilotCostMultiplier ?? null),
    pricingFeatures: tier?.pricingFeatures.join('\n') ?? '',
    isPublic: tier?.isPublic ?? true,
    isDefault: tier?.isDefault ?? false,
    displayOrder: formatOptionalNumber(tier?.displayOrder ?? 0),
  })
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

  const isPublic = readBoolean(formData, 'isPublic')

  return {
    displayName: readRequiredText(formData, 'tierLabel'),
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
    accessCode: isPublic ? null : readOptionalText(formData, 'accessCode'),
    workflowExecutionTimeLimitSeconds: readOptionalInteger(
      formData,
      'workflowExecutionTimeLimitSeconds'
    ),
    syncRateLimitPerMinute: readOptionalInteger(formData, 'syncRateLimitPerMinute'),
    asyncRateLimitPerMinute: readOptionalInteger(formData, 'asyncRateLimitPerMinute'),
    apiEndpointRateLimitPerMinute: readOptionalInteger(formData, 'apiEndpointRateLimitPerMinute'),
    maxPendingAgeSeconds: readOptionalInteger(formData, 'maxPendingAgeSeconds'),
    maxPendingCount: readOptionalInteger(formData, 'maxPendingCount'),
    canEditUsageLimit: readBoolean(formData, 'canEditUsageLimit'),
    canConfigureSso: readBoolean(formData, 'canConfigureSso'),
    logRetentionDays: readOptionalInteger(formData, 'logRetentionDays'),
    workflowExecutionMultiplier: readOptionalNumber(formData, 'workflowExecutionMultiplier'),
    workflowModelCostMultiplier: readOptionalNumber(formData, 'workflowModelCostMultiplier'),
    functionExecutionMultiplier: readOptionalNumber(formData, 'functionExecutionMultiplier'),
    copilotCostMultiplier: readOptionalNumber(formData, 'copilotCostMultiplier'),
    pricingFeatures: readRequiredText(formData, 'pricingFeatures')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean),
    isPublic,
    isDefault: readBoolean(formData, 'isDefault'),
    displayOrder: readOptionalInteger(formData, 'displayOrder') ?? 0,
  }
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

function formatMissingMessage(copy: AdminBillingCopy, items: string[]) {
  return items.length === 0
    ? null
    : formatTemplate(copy.editor.summaries.missing, { items: items.join(', ') })
}

function isFilled(value: string) {
  return value.trim().length > 0
}

function formatCurrencyValue(locale: LocaleCode | string, value: string) {
  if (!isFilled(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? formatUsd(locale, parsed) : `$${value}`
}

function hasPositiveNumber(value: string) {
  if (!isFilled(value)) {
    return false
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

function countPricingFeatureLines(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean).length
}

function getTierSectionSummaries(
  defaults: TierFormDefaults,
  locale: LocaleCode | string,
  copy: AdminBillingCopy
): Record<TierEditorSectionId, TierSectionSummary> {
  const tierStatusOptions = getTierStatusOptions(copy)
  const tierOwnerTypeOptions = getTierOwnerTypeOptions(copy)
  const tierUsageScopeOptions = getTierUsageScopeOptions(copy)
  const tierSeatModeOptions = getTierSeatModeOptions(copy)
  const featureCount = countPricingFeatureLines(defaults.pricingFeatures)
  const commerceLabel = getTierCommerceLabel(defaults)
  const generalMissing = [
    !isFilled(defaults.displayName) ? copy.editor.general.displayName : null,
    !isFilled(defaults.description) ? copy.editor.general.description : null,
    defaults.isDefault && !defaults.isPublic ? copy.editor.summaries.defaultTierMustBePublic : null,
  ].filter((value): value is string => Boolean(value))

  const accessMissing = [
    defaults.isDefault &&
    (defaults.ownerType !== 'user' ||
      defaults.usageScope !== 'individual' ||
      defaults.seatMode !== 'fixed')
      ? copy.editor.summaries.defaultTierMustBePublicPlan
      : null,
    defaults.ownerType === 'user' && defaults.usageScope !== 'individual'
      ? copy.editor.summaries.userTiersIndividualUsage
      : null,
    defaults.ownerType === 'user' && defaults.seatMode !== 'fixed'
      ? copy.editor.summaries.userTiersFixedSeats
      : null,
    defaults.ownerType === 'user' && defaults.canConfigureSso
      ? copy.editor.summaries.userTiersNoSso
      : null,
    defaults.ownerType === 'organization' && !isFilled(defaults.seatCount)
      ? copy.editor.summaries.orgSeatCountRequired
      : null,
    defaults.ownerType === 'organization' &&
    defaults.seatMode === 'fixed' &&
    isFilled(defaults.seatMaximum)
      ? copy.editor.summaries.fixedOrgNoSeatCap
      : null,
  ].filter((value): value is string => Boolean(value))

  const pricingMissing = [
    hasPositiveNumber(defaults.monthlyPriceUsd) && !isFilled(defaults.stripeMonthlyPriceId)
      ? copy.editor.summaries.monthlyStripePrice
      : null,
    hasPositiveNumber(defaults.yearlyPriceUsd) && !isFilled(defaults.stripeYearlyPriceId)
      ? copy.editor.summaries.yearlyStripePrice
      : null,
    commerceLabel === 'free' &&
    (hasPositiveNumber(defaults.monthlyPriceUsd) || hasPositiveNumber(defaults.yearlyPriceUsd))
      ? copy.editor.summaries.freeTiersNoRecurring
      : null,
  ].filter((value): value is string => Boolean(value))

  const seatsMissing =
    defaults.ownerType !== 'organization'
      ? []
      : [!isFilled(defaults.seatCount) ? copy.editor.seats.seatCount : null].filter(
          (value): value is string => Boolean(value)
        )

  const seatRangeInvalid =
    isFilled(defaults.seatCount) &&
    isFilled(defaults.seatMaximum) &&
    Number(defaults.seatMaximum) < Number(defaults.seatCount)

  const configuredLimitCount = [
    defaults.includedUsageLimitUsd,
    defaults.storageLimitGb,
    defaults.concurrencyLimit,
    defaults.workflowExecutionTimeLimitSeconds,
    defaults.syncRateLimitPerMinute,
    defaults.asyncRateLimitPerMinute,
    defaults.apiEndpointRateLimitPerMinute,
    defaults.logRetentionDays,
  ].filter(isFilled).length
  const limitMissing = [
    defaults.status === 'active' && !isFilled(defaults.includedUsageLimitUsd)
      ? copy.editor.summaries.includedUsage
      : null,
    defaults.status === 'active' && !isFilled(defaults.storageLimitGb)
      ? copy.editor.summaries.storage
      : null,
    defaults.status === 'active' && !isFilled(defaults.concurrencyLimit)
      ? copy.editor.summaries.concurrency
      : null,
    defaults.status === 'active' && !isFilled(defaults.syncRateLimitPerMinute)
      ? copy.editor.summaries.syncRate
      : null,
    defaults.status === 'active' && !isFilled(defaults.asyncRateLimitPerMinute)
      ? copy.editor.summaries.asyncRate
      : null,
    defaults.status === 'active' && !isFilled(defaults.apiEndpointRateLimitPerMinute)
      ? copy.editor.summaries.apiRate
      : null,
  ].filter((value): value is string => Boolean(value))

  const configuredMeteringCount = [
    defaults.workflowExecutionMultiplier,
    defaults.workflowModelCostMultiplier,
    defaults.functionExecutionMultiplier,
    defaults.copilotCostMultiplier,
  ].filter(isFilled).length
  const meteringMissing = [
    !isFilled(defaults.workflowExecutionMultiplier)
      ? copy.editor.summaries.workflowExecutionMultiplier
      : null,
    !isFilled(defaults.workflowModelCostMultiplier)
      ? copy.editor.summaries.workflowModelMultiplier
      : null,
    !isFilled(defaults.functionExecutionMultiplier)
      ? copy.editor.summaries.functionRuntimeMultiplier
      : null,
    !isFilled(defaults.copilotCostMultiplier) ? copy.editor.summaries.copilotMultiplier : null,
  ].filter((value): value is string => Boolean(value))

  return {
    general: {
      preview: joinPreviewParts([
        isFilled(defaults.displayName) ? defaults.displayName : copy.editor.summaries.untitledTier,
        getOptionLabel(tierStatusOptions, defaults.status),
        defaults.isPublic ? copy.status.public : copy.status.hidden,
        featureCount > 0
          ? formatTemplate(copy.editor.summaries.pricingBullets, { count: featureCount })
          : copy.editor.summaries.noPricingBullets,
      ]),
      missing: formatMissingMessage(copy, generalMissing),
      status: generalMissing.length === 0 ? 'ready' : 'review',
    },
    access: {
      preview: joinPreviewParts([
        formatTemplate(copy.ownerTypes.ownerLabel, {
          owner: getOptionLabel(tierOwnerTypeOptions, defaults.ownerType),
        }),
        formatTemplate(copy.usageScopes.usageLabel, {
          scope: getOptionLabel(tierUsageScopeOptions, defaults.usageScope),
        }),
        formatTemplate(copy.seatModes.seatBillingLabel, {
          mode: getOptionLabel(tierSeatModeOptions, defaults.seatMode),
        }),
        defaults.canEditUsageLimit
          ? copy.editor.summaries.editableUsageCap
          : copy.editor.summaries.fixedUsageCap,
        defaults.canConfigureSso ? copy.editor.summaries.ssoOn : copy.editor.summaries.ssoOff,
      ]),
      missing: formatMissingMessage(copy, accessMissing),
      status: accessMissing.length === 0 ? 'ready' : 'review',
    },
    pricing: {
      preview: joinPreviewParts([
        commerceLabel === 'free'
          ? copy.commerce.freeTier
          : commerceLabel === 'contact-sales'
            ? copy.commerce.contactSales
            : formatCurrencyValue(locale, defaults.monthlyPriceUsd)
              ? formatTemplate(copy.commerce.monthlyPrice, {
                  amount: formatCurrencyValue(locale, defaults.monthlyPriceUsd) ?? '',
                })
              : formatCurrencyValue(locale, defaults.yearlyPriceUsd)
                ? formatTemplate(copy.commerce.yearlyPrice, {
                    amount: formatCurrencyValue(locale, defaults.yearlyPriceUsd) ?? '',
                  })
                : copy.commerce.priceUnset,
        formatCurrencyValue(locale, defaults.yearlyPriceUsd)
          ? formatTemplate(copy.commerce.yearlyPrice, {
              amount: formatCurrencyValue(locale, defaults.yearlyPriceUsd) ?? '',
            })
          : null,
        formatTemplate(copy.commerce.stripeLinks, {
          count: [
            defaults.stripeMonthlyPriceId,
            defaults.stripeYearlyPriceId,
            defaults.stripeProductId,
          ].filter(isFilled).length,
        }),
      ]),
      missing: formatMissingMessage(copy, pricingMissing),
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
          ? copy.editor.summaries.userTiersNoOrgSeats
          : defaults.seatMode === 'fixed'
            ? joinPreviewParts([
                isFilled(defaults.seatCount)
                  ? formatTemplate(copy.commerce.fixedSeatsCount, { count: defaults.seatCount })
                  : copy.commerce.seatCountUnset,
                copy.commerce.noSelfServeSeatChanges,
              ])
            : joinPreviewParts([
                isFilled(defaults.seatCount)
                  ? formatTemplate(copy.commerce.baseSeatsCount, { count: defaults.seatCount })
                  : copy.commerce.seatCountUnset,
                isFilled(defaults.seatMaximum)
                  ? formatTemplate(copy.commerce.maxSeatsCount, { count: defaults.seatMaximum })
                  : copy.commerce.unlimitedSeats,
              ]),
      missing: formatMissingMessage(
        copy,
        seatRangeInvalid ? [...seatsMissing, copy.editor.summaries.seatMaxAboveCount] : seatsMissing
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
          ? copy.editor.summaries.noLimitsConfigured
          : joinPreviewParts([
              formatCurrencyValue(locale, defaults.includedUsageLimitUsd)
                ? formatTemplate(copy.commerce.includedUsageLabel, {
                    amount: formatCurrencyValue(locale, defaults.includedUsageLimitUsd) ?? '',
                  })
                : null,
              isFilled(defaults.storageLimitGb)
                ? formatTemplate(copy.commerce.storageLimitLabel, {
                    value: defaults.storageLimitGb,
                  })
                : null,
              isFilled(defaults.concurrencyLimit)
                ? formatTemplate(copy.commerce.concurrencyLabel, {
                    value: defaults.concurrencyLimit,
                  })
                : null,
              formatTemplate(copy.editor.summaries.limitsConfigured, {
                count: configuredLimitCount,
              }),
            ]),
      missing: formatMissingMessage(copy, limitMissing),
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
          ? copy.editor.summaries.usingBasePricingOnly
          : joinPreviewParts([
              isFilled(defaults.workflowExecutionMultiplier)
                ? formatTemplate(copy.commerce.workflowExecutionLabel, {
                    value: defaults.workflowExecutionMultiplier,
                  })
                : null,
              isFilled(defaults.workflowModelCostMultiplier)
                ? formatTemplate(copy.commerce.workflowModelsLabel, {
                    value: defaults.workflowModelCostMultiplier,
                  })
                : null,
              isFilled(defaults.functionExecutionMultiplier)
                ? formatTemplate(copy.commerce.functionRuntimeLabel, {
                    value: defaults.functionExecutionMultiplier,
                  })
                : null,
              isFilled(defaults.copilotCostMultiplier)
                ? formatTemplate(copy.commerce.copilotLabel, {
                    value: defaults.copilotCostMultiplier,
                  })
                : null,
            ]),
      missing: configuredMeteringCount === 0 ? formatMissingMessage(copy, meteringMissing) : null,
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
    displayName: readRequiredText(formData, 'tierLabel'),
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
    accessCode: readRequiredText(formData, 'accessCode'),
    workflowExecutionTimeLimitSeconds: readRequiredText(
      formData,
      'workflowExecutionTimeLimitSeconds'
    ),
    syncRateLimitPerMinute: readRequiredText(formData, 'syncRateLimitPerMinute'),
    asyncRateLimitPerMinute: readRequiredText(formData, 'asyncRateLimitPerMinute'),
    apiEndpointRateLimitPerMinute: readRequiredText(formData, 'apiEndpointRateLimitPerMinute'),
    maxPendingAgeSeconds: readRequiredText(formData, 'maxPendingAgeSeconds'),
    maxPendingCount: readRequiredText(formData, 'maxPendingCount'),
    canEditUsageLimit: readBoolean(formData, 'canEditUsageLimit'),
    canConfigureSso: readBoolean(formData, 'canConfigureSso'),
    logRetentionDays: readRequiredText(formData, 'logRetentionDays'),
    workflowExecutionMultiplier: readRequiredText(formData, 'workflowExecutionMultiplier'),
    workflowModelCostMultiplier: readRequiredText(formData, 'workflowModelCostMultiplier'),
    functionExecutionMultiplier: readRequiredText(formData, 'functionExecutionMultiplier'),
    copilotCostMultiplier: readRequiredText(formData, 'copilotCostMultiplier'),
    pricingFeatures: String(formData.get('pricingFeatures') ?? ''),
    isPublic: readBoolean(formData, 'isPublic'),
    isDefault: readBoolean(formData, 'isDefault'),
    displayOrder: readRequiredText(formData, 'displayOrder') || '0',
  })
}

function FieldHint({ children }: { children: ReactNode }) {
  return <p className='text-muted-foreground text-xs leading-relaxed'>{children}</p>
}

function OptionalFieldBadge({ label }: { label: string }) {
  return (
    <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
      {label}
    </Badge>
  )
}

export function FieldShell({
  id,
  label,
  hint,
  nullable = false,
  blankHint,
  className,
  optionalLabel,
  defaultBlankHint,
  children,
}: {
  id: string
  label: ReactNode
  hint: ReactNode
  nullable?: boolean
  blankHint?: ReactNode
  className?: string
  optionalLabel?: string
  defaultBlankHint?: ReactNode
  children: ReactNode
}) {
  const resolvedHint = nullable ? (
    <>
      {hint} {blankHint ?? defaultBlankHint}
    </>
  ) : (
    hint
  )

  return (
    <div className={cn('space-y-2', className)}>
      <div className='flex min-h-6 items-center gap-2'>
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
        </Label>
        {nullable && optionalLabel ? <OptionalFieldBadge label={optionalLabel} /> : null}
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
  statusLabels,
  children,
}: {
  sectionId: TierEditorSectionId
  title: string
  summary: TierSectionSummary
  open: boolean
  onOpenChange: (open: boolean) => void
  statusLabels: AdminBillingCopy['editor']['sectionStatuses']
  children: ReactNode
}) {
  return (
    <section id={`tier-section-${sectionId}`} className='border-border/60 border-b last:border-b-0'>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          render={
            <Button
              type='button'
              variant='ghost'
              className='flex h-auto w-full items-start justify-between gap-4 rounded-none px-4 py-4 text-left hover:bg-muted/30 sm:px-5'
            />
          }
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
                  ? statusLabels.ready
                  : summary.status === 'review'
                    ? statusLabels.review
                    : statusLabels.optional}
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
  label: ReactNode
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  hint: ReactNode
  disabled?: boolean
  className?: string
  triggerClassName?: string
}) {
  const selectProps =
    value !== undefined
      ? {
          value,
          onValueChange: (nextValue: string | null | undefined) => {
            if (nextValue != null) onValueChange?.(nextValue)
          },
        }
      : {
          defaultValue,
        }

  return (
    <FieldShell id={id} label={label} hint={hint} className={className}>
      <Select name={name} disabled={disabled} items={options} {...selectProps}>
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} className={triggerClassName}>
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
  label: ReactNode
  defaultChecked: boolean
  hint?: ReactNode
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

export function TierEditorFormSurface({
  copy,
  locale,
  formId,
  initialValues,
  previewValues,
  sectionState,
  onSectionStateChange,
  onAccessFieldChange,
  isPending,
  onSubmit,
  onFormChange,
  footer,
}: {
  copy: AdminBillingCopy
  locale: LocaleCode | string
  formId: string
  initialValues: TierFormDefaults
  previewValues: TierFormDefaults
  sectionState: TierEditorSectionState
  onSectionStateChange: (sectionId: TierEditorSectionId, open: boolean) => void
  onAccessFieldChange: (field: keyof TierDerivedAccessFields, value: string) => void
  isPending: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  onFormChange: (event: FormEvent<HTMLFormElement>) => void
  footer?: ReactNode
}) {
  const sectionSummaries = getTierSectionSummaries(previewValues, locale, copy)
  const derivedAccessFields = normalizeTierAccessFields(previewValues)
  const tierStatusOptions = getTierStatusOptions(copy)
  const tierOwnerTypeOptions = getTierOwnerTypeOptions(copy)
  const tierUsageScopeOptions = getTierUsageScopeOptions(copy)
  const tierSeatModeOptions = getTierSeatModeOptions(copy)

  return (
    <div className='overflow-hidden rounded-lg border border-border bg-background'>
      <form id={formId} aria-busy={isPending} onSubmit={onSubmit} onChange={onFormChange}>
        <fieldset disabled={isPending}>
          <legend className='sr-only'>{copy.editor.sections.general}</legend>
          <div>
            <TierFormSection
              sectionId='general'
              title={copy.editor.sections.general}
              summary={sectionSummaries.general}
              open={sectionState.general}
              onOpenChange={(open) => onSectionStateChange('general', open)}
              statusLabels={copy.editor.sectionStatuses}
            >
              <div className='space-y-4'>
                <div className='space-y-3'>
                  <FieldHint>{copy.editor.general.intro}</FieldHint>
                  <div className='grid gap-3 md:grid-cols-2'>
                    <SwitchField
                      id='isPublic'
                      name='isPublic'
                      label={copy.editor.general.publicTier}
                      defaultChecked={initialValues.isPublic}
                    />
                    <SwitchField
                      id='isDefault'
                      name='isDefault'
                      label={copy.editor.general.defaultTier}
                      defaultChecked={initialValues.isDefault}
                    />
                  </div>
                  <FieldHint>{copy.editor.general.defaultRules}</FieldHint>
                </div>

                <div className='grid gap-3 md:grid-cols-12'>
                  <FieldShell
                    id='tierLabel'
                    label={copy.editor.general.displayName}
                    hint={copy.editor.general.displayNameHint}
                    className='md:col-span-7'
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='tierLabel'
                      name='tierLabel'
                      aria-labelledby='tierLabel-label'
                      defaultValue={initialValues.displayName}
                      className='h-9'
                      required
                    />
                  </FieldShell>
                  <FieldShell
                    id='status'
                    label={copy.editor.general.status}
                    hint={copy.editor.general.statusHint}
                    className='md:col-span-3'
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Select
                      name='status'
                      defaultValue={initialValues.status}
                      items={tierStatusOptions}
                    >
                      <SelectTrigger id='status' aria-labelledby='status-label' className='h-9'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tierStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldShell>
                  <FieldShell
                    id='displayOrder'
                    label={copy.editor.general.displayOrder}
                    hint={copy.editor.general.displayOrderHint}
                    className='md:col-span-2'
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='displayOrder'
                      name='displayOrder'
                      aria-labelledby='displayOrder-label'
                      type='number'
                      defaultValue={initialValues.displayOrder}
                      className='h-9'
                    />
                  </FieldShell>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <FieldShell
                    id='description'
                    label={copy.editor.general.description}
                    hint={copy.editor.general.descriptionHint}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Textarea
                      id='description'
                      name='description'
                      aria-labelledby='description-label'
                      defaultValue={initialValues.description}
                      rows={3}
                      className='min-h-[112px]'
                      required
                    />
                  </FieldShell>
                  <FieldShell
                    id='pricingFeatures'
                    label={copy.editor.general.pricingFeatures}
                    hint={copy.editor.general.pricingFeaturesHint}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Textarea
                      id='pricingFeatures'
                      name='pricingFeatures'
                      aria-labelledby='pricingFeatures-label'
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
              title={copy.editor.sections.pricing}
              summary={sectionSummaries.pricing}
              open={sectionState.pricing}
              onOpenChange={(open) => onSectionStateChange('pricing', open)}
              statusLabels={copy.editor.sectionStatuses}
            >
              <div className='space-y-4'>
                <div className='grid gap-4 xl:grid-cols-2'>
                  <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                    <div className='space-y-1'>
                      <p className='font-medium text-sm'>{copy.editor.pricing.monthlyTitle}</p>
                      <p className='text-muted-foreground text-xs leading-relaxed'>
                        {copy.editor.pricing.monthlyDescription}
                      </p>
                    </div>
                    <FieldShell
                      id='monthlyPriceUsd'
                      label={copy.editor.pricing.monthlyPrice}
                      hint={copy.editor.pricing.monthlyPriceHint}
                      nullable
                      blankHint={copy.editor.pricing.monthlyBlank}
                      optionalLabel={copy.editor.optional}
                      defaultBlankHint={copy.editor.defaultBlankHint}
                    >
                      <Input
                        id='monthlyPriceUsd'
                        name='monthlyPriceUsd'
                        aria-labelledby='monthlyPriceUsd-label'
                        type='number'
                        step='0.01'
                        defaultValue={initialValues.monthlyPriceUsd}
                      />
                    </FieldShell>
                    <FieldShell
                      id='stripeMonthlyPriceId'
                      label={copy.editor.pricing.stripeMonthlyPriceId}
                      hint={copy.editor.pricing.stripeMonthlyPriceIdHint}
                      nullable
                      blankHint={copy.editor.pricing.stripeMonthlyPriceIdBlank}
                      optionalLabel={copy.editor.optional}
                      defaultBlankHint={copy.editor.defaultBlankHint}
                    >
                      <Input
                        id='stripeMonthlyPriceId'
                        name='stripeMonthlyPriceId'
                        aria-labelledby='stripeMonthlyPriceId-label'
                        defaultValue={initialValues.stripeMonthlyPriceId}
                      />
                    </FieldShell>
                  </div>

                  <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                    <div className='space-y-1'>
                      <p className='font-medium text-sm'>{copy.editor.pricing.yearlyTitle}</p>
                      <p className='text-muted-foreground text-xs leading-relaxed'>
                        {copy.editor.pricing.yearlyDescription}
                      </p>
                    </div>
                    <FieldShell
                      id='yearlyPriceUsd'
                      label={copy.editor.pricing.yearlyPrice}
                      hint={copy.editor.pricing.yearlyPriceHint}
                      nullable
                      blankHint={copy.editor.pricing.yearlyBlank}
                      optionalLabel={copy.editor.optional}
                      defaultBlankHint={copy.editor.defaultBlankHint}
                    >
                      <Input
                        id='yearlyPriceUsd'
                        name='yearlyPriceUsd'
                        aria-labelledby='yearlyPriceUsd-label'
                        type='number'
                        step='0.01'
                        defaultValue={initialValues.yearlyPriceUsd}
                      />
                    </FieldShell>
                    <FieldShell
                      id='stripeYearlyPriceId'
                      label={copy.editor.pricing.stripeYearlyPriceId}
                      hint={copy.editor.pricing.stripeYearlyPriceIdHint}
                      nullable
                      blankHint={copy.editor.pricing.stripeYearlyPriceIdBlank}
                      optionalLabel={copy.editor.optional}
                      defaultBlankHint={copy.editor.defaultBlankHint}
                    >
                      <Input
                        id='stripeYearlyPriceId'
                        name='stripeYearlyPriceId'
                        aria-labelledby='stripeYearlyPriceId-label'
                        defaultValue={initialValues.stripeYearlyPriceId}
                      />
                    </FieldShell>
                  </div>
                </div>

                <div className='rounded-md border border-border/60 bg-background px-4 py-4'>
                  <FieldShell
                    id='stripeProductId'
                    label={copy.editor.pricing.stripeProductId}
                    hint={copy.editor.pricing.stripeProductIdHint}
                    nullable
                    blankHint={copy.editor.pricing.stripeProductIdBlank}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='stripeProductId'
                      name='stripeProductId'
                      aria-labelledby='stripeProductId-label'
                      defaultValue={initialValues.stripeProductId}
                    />
                  </FieldShell>
                </div>
              </div>
            </TierFormSection>

            <TierFormSection
              sectionId='access'
              title={copy.editor.sections.access}
              summary={sectionSummaries.access}
              open={sectionState.access}
              onOpenChange={(open) => onSectionStateChange('access', open)}
              statusLabels={copy.editor.sectionStatuses}
            >
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                <SelectField
                  id='ownerType'
                  name='ownerType'
                  label={copy.editor.access.ownerType}
                  value={derivedAccessFields.ownerType}
                  options={tierOwnerTypeOptions}
                  hint={copy.editor.access.ownerTypeHint}
                  onValueChange={(value) => onAccessFieldChange('ownerType', value)}
                />
                <SelectField
                  id='usageScope'
                  name='usageScope'
                  label={copy.editor.access.usageScope}
                  value={derivedAccessFields.usageScope}
                  options={tierUsageScopeOptions}
                  hint={copy.editor.access.usageScopeHint}
                  disabled={derivedAccessFields.ownerType === 'user'}
                  onValueChange={(value) => onAccessFieldChange('usageScope', value)}
                />
                <SelectField
                  id='seatMode'
                  name='seatMode'
                  label={copy.editor.access.seatMode}
                  value={derivedAccessFields.seatMode}
                  options={tierSeatModeOptions}
                  hint={copy.editor.access.seatModeHint}
                  disabled={derivedAccessFields.ownerType === 'user'}
                  onValueChange={(value) => onAccessFieldChange('seatMode', value)}
                />
                <SwitchField
                  id='canEditUsageLimit'
                  name='canEditUsageLimit'
                  label={copy.editor.access.canEditUsageLimit}
                  defaultChecked={initialValues.canEditUsageLimit}
                  hint={copy.editor.access.canEditUsageLimitHint}
                />
                <SwitchField
                  id='canConfigureSso'
                  name='canConfigureSso'
                  label={copy.editor.access.canConfigureSso}
                  defaultChecked={initialValues.canConfigureSso}
                  hint={copy.editor.access.canConfigureSsoHint}
                />
                {!previewValues.isPublic ? (
                  <FieldShell
                    id='accessCode'
                    label={copy.editor.access.accessCode}
                    hint={copy.editor.access.accessCodeHint}
                    nullable
                    blankHint={copy.editor.access.accessCodeBlank}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='accessCode'
                      name='accessCode'
                      aria-labelledby='accessCode-label'
                      defaultValue={initialValues.accessCode}
                    />
                  </FieldShell>
                ) : (
                  <input type='hidden' name='accessCode' value='' />
                )}
              </div>
            </TierFormSection>

            {derivedAccessFields.ownerType === 'organization' ? (
              <TierFormSection
                sectionId='seats'
                title={copy.editor.sections.seats}
                summary={sectionSummaries.seats}
                open={sectionState.seats}
                onOpenChange={(open) => onSectionStateChange('seats', open)}
                statusLabels={copy.editor.sectionStatuses}
              >
                <div className='grid gap-4 md:grid-cols-2'>
                  <FieldShell
                    id='seatCount'
                    label={copy.editor.seats.seatCount}
                    hint={copy.editor.seats.seatCountHint}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='seatCount'
                      name='seatCount'
                      aria-labelledby='seatCount-label'
                      type='number'
                      defaultValue={initialValues.seatCount}
                    />
                  </FieldShell>
                  <FieldShell
                    id='seatMaximum'
                    label={copy.editor.seats.seatMaximum}
                    hint={copy.editor.seats.seatMaximumHint}
                    nullable
                    blankHint={copy.editor.seats.seatMaximumBlank}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='seatMaximum'
                      name='seatMaximum'
                      aria-labelledby='seatMaximum-label'
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
              title={copy.editor.sections.limits}
              summary={sectionSummaries.limits}
              open={sectionState.limits}
              onOpenChange={(open) => onSectionStateChange('limits', open)}
              statusLabels={copy.editor.sectionStatuses}
            >
              <div className='space-y-4'>
                <div className='grid gap-4 xl:grid-cols-2'>
                  <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                    <div className='space-y-1'>
                      <p className='font-medium text-sm'>{copy.editor.limits.allowanceTitle}</p>
                      <p className='text-muted-foreground text-xs leading-relaxed'>
                        {copy.editor.limits.allowanceDescription}
                      </p>
                    </div>
                    <div className='grid gap-4'>
                      <FieldShell
                        id='includedUsageLimitUsd'
                        label={copy.editor.limits.includedUsage}
                        hint={copy.editor.limits.includedUsageHint}
                        nullable
                        blankHint={copy.editor.limits.includedUsageBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='includedUsageLimitUsd'
                          name='includedUsageLimitUsd'
                          aria-labelledby='includedUsageLimitUsd-label'
                          type='number'
                          step='0.01'
                          defaultValue={initialValues.includedUsageLimitUsd}
                        />
                      </FieldShell>
                      <FieldShell
                        id='storageLimitGb'
                        label={copy.editor.limits.storageLimit}
                        hint={copy.editor.limits.storageLimitHint}
                        nullable
                        blankHint={copy.editor.limits.storageLimitBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='storageLimitGb'
                          name='storageLimitGb'
                          aria-labelledby='storageLimitGb-label'
                          type='number'
                          defaultValue={initialValues.storageLimitGb}
                        />
                      </FieldShell>
                      <FieldShell
                        id='logRetentionDays'
                        label={copy.editor.limits.logRetentionDays}
                        hint={copy.editor.limits.logRetentionDaysHint}
                        nullable
                        blankHint={copy.editor.limits.logRetentionDaysBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='logRetentionDays'
                          name='logRetentionDays'
                          aria-labelledby='logRetentionDays-label'
                          type='number'
                          defaultValue={initialValues.logRetentionDays}
                        />
                      </FieldShell>
                    </div>
                  </div>

                  <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                    <div className='space-y-1'>
                      <p className='font-medium text-sm'>{copy.editor.limits.throughputTitle}</p>
                      <p className='text-muted-foreground text-xs leading-relaxed'>
                        {copy.editor.limits.throughputDescription}
                      </p>
                    </div>
                    <div className='grid gap-4 md:grid-cols-2'>
                      <FieldShell
                        id='concurrencyLimit'
                        label={copy.editor.limits.concurrencyLimit}
                        hint={copy.editor.limits.concurrencyLimitHint}
                        nullable
                        blankHint={copy.editor.limits.concurrencyLimitBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='concurrencyLimit'
                          name='concurrencyLimit'
                          aria-labelledby='concurrencyLimit-label'
                          type='number'
                          defaultValue={initialValues.concurrencyLimit}
                        />
                      </FieldShell>
                      <FieldShell
                        id='workflowExecutionTimeLimitSeconds'
                        label={copy.editor.limits.workflowExecutionTimeLimit}
                        hint={copy.editor.limits.workflowExecutionTimeLimitHint}
                        nullable
                        blankHint={copy.editor.limits.workflowExecutionTimeLimitBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='workflowExecutionTimeLimitSeconds'
                          name='workflowExecutionTimeLimitSeconds'
                          aria-labelledby='workflowExecutionTimeLimitSeconds-label'
                          type='number'
                          min='1'
                          step='1'
                          defaultValue={initialValues.workflowExecutionTimeLimitSeconds}
                        />
                      </FieldShell>
                    </div>
                    <div className='grid gap-4 md:grid-cols-2'>
                      <FieldShell
                        id='syncRateLimitPerMinute'
                        label={copy.editor.limits.syncRateLimit}
                        hint={copy.editor.limits.syncRateLimitHint}
                        nullable
                        blankHint={copy.editor.limits.syncRateLimitBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='syncRateLimitPerMinute'
                          name='syncRateLimitPerMinute'
                          aria-labelledby='syncRateLimitPerMinute-label'
                          type='number'
                          defaultValue={initialValues.syncRateLimitPerMinute}
                        />
                      </FieldShell>
                      <FieldShell
                        id='asyncRateLimitPerMinute'
                        label={copy.editor.limits.asyncRateLimit}
                        hint={copy.editor.limits.asyncRateLimitHint}
                        nullable
                        blankHint={copy.editor.limits.asyncRateLimitBlank}
                        optionalLabel={copy.editor.optional}
                        defaultBlankHint={copy.editor.defaultBlankHint}
                      >
                        <Input
                          id='asyncRateLimitPerMinute'
                          name='asyncRateLimitPerMinute'
                          aria-labelledby='asyncRateLimitPerMinute-label'
                          type='number'
                          defaultValue={initialValues.asyncRateLimitPerMinute}
                        />
                      </FieldShell>
                    </div>
                    <FieldShell
                      id='apiEndpointRateLimitPerMinute'
                      label={copy.editor.limits.apiRateLimit}
                      hint={copy.editor.limits.apiRateLimitHint}
                      nullable
                      blankHint={copy.editor.limits.apiRateLimitBlank}
                      optionalLabel={copy.editor.optional}
                      defaultBlankHint={copy.editor.defaultBlankHint}
                    >
                      <Input
                        id='apiEndpointRateLimitPerMinute'
                        name='apiEndpointRateLimitPerMinute'
                        aria-labelledby='apiEndpointRateLimitPerMinute-label'
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
              title={copy.editor.sections.metering}
              summary={sectionSummaries.metering}
              open={sectionState.metering}
              onOpenChange={(open) => onSectionStateChange('metering', open)}
              statusLabels={copy.editor.sectionStatuses}
            >
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                <FieldShell
                  id='workflowExecutionMultiplier'
                  label={copy.editor.metering.workflowExecutionMultiplier}
                  hint={copy.editor.metering.workflowExecutionMultiplierHint}
                  nullable
                  blankHint={copy.editor.metering.workflowExecutionMultiplierBlank}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='workflowExecutionMultiplier'
                    name='workflowExecutionMultiplier'
                    aria-labelledby='workflowExecutionMultiplier-label'
                    type='number'
                    step='0.01'
                    defaultValue={initialValues.workflowExecutionMultiplier}
                  />
                </FieldShell>
                <FieldShell
                  id='workflowModelCostMultiplier'
                  label={copy.editor.metering.workflowModelCostMultiplier}
                  hint={copy.editor.metering.workflowModelCostMultiplierHint}
                  nullable
                  blankHint={copy.editor.metering.workflowModelCostMultiplierBlank}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='workflowModelCostMultiplier'
                    name='workflowModelCostMultiplier'
                    aria-labelledby='workflowModelCostMultiplier-label'
                    type='number'
                    step='0.01'
                    defaultValue={initialValues.workflowModelCostMultiplier}
                  />
                </FieldShell>
                <FieldShell
                  id='functionExecutionMultiplier'
                  label={copy.editor.metering.functionExecutionMultiplier}
                  hint={copy.editor.metering.functionExecutionMultiplierHint}
                  nullable
                  blankHint={copy.editor.metering.functionExecutionMultiplierBlank}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='functionExecutionMultiplier'
                    name='functionExecutionMultiplier'
                    aria-labelledby='functionExecutionMultiplier-label'
                    type='number'
                    step='0.0001'
                    defaultValue={initialValues.functionExecutionMultiplier}
                  />
                </FieldShell>
                <FieldShell
                  id='copilotCostMultiplier'
                  label={copy.editor.metering.copilotCostMultiplier}
                  hint={copy.editor.metering.copilotCostMultiplierHint}
                  nullable
                  blankHint={copy.editor.metering.copilotCostMultiplierBlank}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='copilotCostMultiplier'
                    name='copilotCostMultiplier'
                    aria-labelledby='copilotCostMultiplier-label'
                    type='number'
                    step='0.01'
                    defaultValue={initialValues.copilotCostMultiplier}
                  />
                </FieldShell>
              </div>
            </TierFormSection>
          </div>
          {footer ? (
            <div className='border-border/60 border-t px-4 py-4 sm:px-5'>{footer}</div>
          ) : null}
        </fieldset>
      </form>
    </div>
  )
}

export function TierEditorHeaderCenter({
  copy,
  locale,
  previewValues,
  extraStats = [],
}: {
  copy: AdminBillingCopy
  locale: LocaleCode | string
  previewValues: TierFormDefaults
  extraStats?: Array<{ label: string; value: string }>
}) {
  const summaries = getTierSectionSummaries(previewValues, locale, copy)
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
    { label: copy.editor.sectionStatuses.ready, value: String(readyCount) },
    { label: copy.editor.sectionStatuses.review, value: String(reviewCount) },
    { label: copy.editor.sectionStatuses.optional, value: String(optionalCount) },
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
