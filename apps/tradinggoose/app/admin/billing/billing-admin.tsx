'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Plus, Receipt } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Notice,
} from '@/components/ui'
import type { AdminBillingSettingsMutationInput } from '@/lib/admin/billing/settings-mutations'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { ADMIN_META_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
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
import { formatLocalizedNumber, formatUsd } from '@/i18n/formatters'
import { Link, useRouter } from '@/i18n/navigation'
import { formatTemplate, type LocaleCode } from '@/i18n/utils'
import {
  type AdminBillingCopy,
  BillingBreadcrumbs,
  buildTierMutationInput,
  createTierFormDefaults,
  createTierPreviewState,
  DEFAULT_TIER_EDITOR_SECTIONS,
  FieldShell,
  getBillingStatusLabel,
  getErrorMessage,
  normalizeTierFormDefaults,
  type TierDerivedAccessFields,
  TierEditorFormSurface,
  TierEditorHeaderCenter,
  type TierEditorSectionState,
  type TierFormDefaults,
} from './tier-editor'

type BillingSettingsFormDefaults = {
  onboardingAllowanceUsd: string
  overageThresholdDollars: string
  workflowExecutionChargeUsd: string
  functionExecutionChargeUsd: string
  usageWarningThresholdPercent: string
  freeTierUpgradeThresholdPercent: string
  enterpriseContactUrl: string
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

function formatMoney(locale: LocaleCode | string, copy: AdminBillingCopy, value: number | null) {
  if (value === null) {
    return copy.commerce.custom
  }

  return formatUsd(locale, value)
}

function formatNullableNumber(
  locale: LocaleCode | string,
  copy: AdminBillingCopy,
  value: number | null,
  formatter: (resolvedValue: string) => string
) {
  if (value === null) {
    return copy.commerce.custom
  }

  return formatter(formatLocalizedNumber(locale, value))
}

function getTierCommerceSummary(copy: AdminBillingCopy, tier: AdminBillingTierSnapshot): string {
  const hasRecurringPrice =
    (tier.monthlyPriceUsd !== null && tier.monthlyPriceUsd > 0) ||
    (tier.yearlyPriceUsd !== null && tier.yearlyPriceUsd > 0)
  if (!hasRecurringPrice) {
    return copy.commerce.freeTier
  }
  if (tier.stripeMonthlyPriceId || tier.stripeYearlyPriceId) {
    return copy.commerce.selfServe
  }
  return copy.commerce.contactSales
}

function formatTierRecurringPrice(
  locale: LocaleCode | string,
  copy: AdminBillingCopy,
  tier: AdminBillingTierSnapshot
): string {
  if (tier.monthlyPriceUsd !== null) {
    return formatMoney(locale, copy, tier.monthlyPriceUsd)
  }

  if (tier.yearlyPriceUsd !== null) {
    return formatTemplate(copy.commerce.yearlyPrice, {
      amount: formatMoney(locale, copy, tier.yearlyPriceUsd),
    })
  }

  return getTierCommerceSummary(copy, tier)
}

function BillingTierOverviewCard({
  copy,
  locale,
  tier,
}: {
  copy: AdminBillingCopy
  locale: LocaleCode | string
  tier: AdminBillingTierSnapshot
}) {
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
                {getBillingStatusLabel(copy, tier.status)}
              </Badge>
              <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                {tier.isPublic ? copy.status.public : copy.status.hidden}
              </Badge>
              {tier.isDefault ? (
                <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                  {copy.status.default}
                </Badge>
              ) : null}
            </div>
          </div>
          <Badge variant='secondary' className={ADMIN_META_BADGE_CLASSNAME}>
            {formatTemplate(copy.overview.subscriptionCount, {
              count: formatLocalizedNumber(locale, tier.subscriptionCount),
            })}
          </Badge>
        </div>

        <div className='flex flex-col gap-2 text-muted-foreground text-xs'>
          <div className='flex flex-wrap items-center gap-2'>
            <span>{getTierCommerceSummary(copy, tier)}</span>
            <span>•</span>
            <span>
              {tier.ownerType === 'organization'
                ? copy.ownerTypes.organizationOwner
                : copy.ownerTypes.userOwner}
            </span>
            <span>•</span>
            <span>
              {tier.usageScope === 'pooled'
                ? copy.usageScopes.pooledUsage
                : copy.usageScopes.individualUsage}
            </span>
            <span>•</span>
            <span>
              {tier.seatMode === 'adjustable'
                ? copy.seatModes.adjustableSeats
                : copy.seatModes.fixedSeats}
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <span>{formatTierRecurringPrice(locale, copy, tier)}</span>
            <span>•</span>
            <span>
              {formatNullableNumber(locale, copy, tier.includedUsageLimitUsd, (value) =>
                formatTemplate(copy.commerce.usdIncluded, { value })
              )}
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <span>
              {formatNullableNumber(locale, copy, tier.storageLimitGb, (value) =>
                formatTemplate(copy.commerce.gbStorage, { value })
              )}
            </span>
            <span>•</span>
            <span>
              {formatNullableNumber(locale, copy, tier.concurrencyLimit, (value) =>
                formatTemplate(copy.commerce.concurrent, { value })
              )}
            </span>
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
  copy,
  locale,
  snapshot,
}: {
  copy: AdminBillingCopy
  locale: LocaleCode | string
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
      setMessage(copy.settings.updated)
    } catch (submitError) {
      setError(getErrorMessage(submitError, copy.errors.unknown))
    }
  }

  return (
    <Card className='overflow-hidden rounded-lg border border-border bg-muted/10'>
      <CardHeader className='border-border/60 border-b bg-muted/10 px-4 py-4 sm:px-5'>
        <CardTitle className='text-sm'>{copy.settings.cardTitle}</CardTitle>
        <CardDescription>{copy.settings.description}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 bg-muted/10 px-4 py-4 sm:px-5'>
        <form onSubmit={handleSubmit} aria-busy={updateSettings.isPending} className='space-y-4'>
          <fieldset disabled={updateSettings.isPending} className='space-y-4'>
            <legend className='sr-only'>{copy.settings.cardTitle}</legend>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>{copy.settings.thresholds.title}</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {copy.settings.thresholds.description}
                </p>
              </div>
              <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
                <FieldShell
                  id='onboardingAllowanceUsd'
                  label={copy.settings.thresholds.onboardingAllowance}
                  hint={copy.settings.thresholds.onboardingAllowanceHint}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='onboardingAllowanceUsd'
                    name='onboardingAllowanceUsd'
                    aria-labelledby='onboardingAllowanceUsd-label'
                    type='number'
                    step='0.01'
                    defaultValue={defaults.onboardingAllowanceUsd}
                  />
                </FieldShell>
                <FieldShell
                  id='overageThresholdDollars'
                  label={copy.settings.thresholds.overageThreshold}
                  hint={copy.settings.thresholds.overageThresholdHint}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='overageThresholdDollars'
                    name='overageThresholdDollars'
                    aria-labelledby='overageThresholdDollars-label'
                    type='number'
                    step='0.01'
                    defaultValue={defaults.overageThresholdDollars}
                  />
                </FieldShell>
                <FieldShell
                  id='usageWarningThresholdPercent'
                  label={copy.settings.thresholds.usageWarning}
                  hint={copy.settings.thresholds.usageWarningHint}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='usageWarningThresholdPercent'
                    name='usageWarningThresholdPercent'
                    aria-labelledby='usageWarningThresholdPercent-label'
                    type='number'
                    defaultValue={defaults.usageWarningThresholdPercent}
                  />
                </FieldShell>
                <FieldShell
                  id='freeTierUpgradeThresholdPercent'
                  label={copy.settings.thresholds.freeTierUpgrade}
                  hint={copy.settings.thresholds.freeTierUpgradeHint}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='freeTierUpgradeThresholdPercent'
                    name='freeTierUpgradeThresholdPercent'
                    aria-labelledby='freeTierUpgradeThresholdPercent-label'
                    type='number'
                    defaultValue={defaults.freeTierUpgradeThresholdPercent}
                  />
                </FieldShell>
              </div>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                <div className='space-y-1'>
                  <p className='font-medium text-sm'>{copy.settings.baseCharges.title}</p>
                  <p className='text-muted-foreground text-xs leading-relaxed'>
                    {copy.settings.baseCharges.description}
                  </p>
                </div>
                <div className='grid gap-4 md:grid-cols-2'>
                  <FieldShell
                    id='workflowExecutionChargeUsd'
                    label={copy.settings.baseCharges.workflowExecutionCharge}
                    hint={copy.settings.baseCharges.workflowExecutionChargeHint}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='workflowExecutionChargeUsd'
                      name='workflowExecutionChargeUsd'
                      aria-labelledby='workflowExecutionChargeUsd-label'
                      type='number'
                      step='0.0001'
                      defaultValue={defaults.workflowExecutionChargeUsd}
                    />
                  </FieldShell>
                  <FieldShell
                    id='functionExecutionChargeUsd'
                    label={copy.settings.baseCharges.functionExecutionCharge}
                    hint={copy.settings.baseCharges.functionExecutionChargeHint}
                    optionalLabel={copy.editor.optional}
                    defaultBlankHint={copy.editor.defaultBlankHint}
                  >
                    <Input
                      id='functionExecutionChargeUsd'
                      name='functionExecutionChargeUsd'
                      aria-labelledby='functionExecutionChargeUsd-label'
                      type='number'
                      step='0.0001'
                      defaultValue={defaults.functionExecutionChargeUsd}
                    />
                  </FieldShell>
                </div>
              </div>

              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                <div className='space-y-1'>
                  <p className='font-medium text-sm'>{copy.settings.enterprise.title}</p>
                  <p className='text-muted-foreground text-xs leading-relaxed'>
                    {copy.settings.enterprise.description}
                  </p>
                </div>
                <FieldShell
                  id='enterpriseContactUrl'
                  label={copy.settings.enterprise.url}
                  hint={copy.settings.enterprise.urlHint}
                  nullable
                  blankHint={copy.settings.enterprise.urlBlankHint}
                  optionalLabel={copy.editor.optional}
                  defaultBlankHint={copy.editor.defaultBlankHint}
                >
                  <Input
                    id='enterpriseContactUrl'
                    name='enterpriseContactUrl'
                    aria-labelledby='enterpriseContactUrl-label'
                    defaultValue={defaults.enterpriseContactUrl}
                  />
                </FieldShell>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {copy.settings.enterprise.helper}
                </p>
              </div>
            </div>

            {error ? (
              <Alert role='alert' variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {message ? (
              <div role='status'>
                <Notice variant='success' title={copy.settings.savedTitle}>
                  {message}
                </Notice>
              </div>
            ) : null}
            <PrimaryButton type='submit' disabled={updateSettings.isPending}>
              {updateSettings.isPending ? copy.settings.saving : copy.settings.save}
            </PrimaryButton>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}

export function AdminBilling() {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().admin.billing
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
      <BillingBreadcrumbs
        items={[
          { label: copy.breadcrumbs.admin, href: '/admin' },
          { label: copy.breadcrumbs.billing },
        ]}
      />
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={copy.overview.searchPlaceholder}
          clearLabel={copy.overview.clearSearch}
          className='w-full'
        />
      </div>
    </div>
  )

  const headerRight = (
    <PrimaryButton onClick={() => router.push('/admin/billing/create')}>
      <Plus className='h-3.5 w-3.5' />
      <span>{copy.overview.createTier}</span>
    </PrimaryButton>
  )

  const defaultTier = snapshot?.currentTiers.find((tier) => tier.isDefault) ?? null
  const publicTierCount = snapshot?.currentTiers.filter((tier) => tier.isPublic).length ?? 0

  const headerCenter = snapshot ? (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.overview.header.billing}</span>
        <span className='font-medium text-[11px] text-foreground'>
          {snapshot.billingEnabled ? copy.status.enabled : copy.status.disabled}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.overview.header.tiers}</span>
        <span className='font-medium text-[11px] text-foreground'>
          {formatLocalizedNumber(locale, snapshot.currentTiers.length)}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.overview.header.public}</span>
        <span className='font-medium text-[11px] text-foreground'>
          {formatLocalizedNumber(locale, publicTierCount)}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.overview.header.default}</span>
        <span className='max-w-[140px] truncate font-medium text-[11px] text-foreground'>
          {defaultTier?.displayName ?? copy.overview.header.notSet}
        </span>
      </div>
      <div className='flex items-baseline gap-1 whitespace-nowrap'>
        <span className='text-[11px] text-muted-foreground'>{copy.overview.header.rates}</span>
        <span className='font-medium text-[11px] text-foreground'>
          {formatTemplate(copy.overview.header.workflowRunRate, {
            amount: snapshot.workflowExecutionChargeUsd,
          })}{' '}
          •{' '}
          {formatTemplate(copy.overview.header.functionSecondRate, {
            amount: snapshot.functionExecutionChargeUsd,
          })}
        </span>
      </div>
    </div>
  ) : null

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>
              {getErrorMessage(snapshotQuery.error, copy.errors.unknown)}
            </AlertDescription>
          </Alert>
        ) : null}

        {snapshotQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>{copy.overview.loadingInventory}</p>
          </div>
        ) : null}

        {snapshot ? (
          <>
            <BillingSettingsCard copy={copy} locale={locale} snapshot={snapshot} />

            <div className='space-y-1'>
              <h2 className='font-medium text-sm'>{copy.overview.currentTiersTitle}</h2>
              <p className='text-muted-foreground text-sm'>
                {copy.overview.currentTiersDescription}
              </p>
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
              {snapshot.currentTiers.length === 0 ? (
                <EmptyStateCard
                  title={copy.overview.emptyTitle}
                  description={copy.overview.emptyDescription}
                  actionLabel={copy.overview.emptyButton}
                  onAction={() => router.push('/admin/billing/create')}
                  icon={<Receipt className='h-4 w-4 text-muted-foreground' />}
                />
              ) : filteredTiers.length === 0 ? (
                <div className='col-span-full py-12 text-center'>
                  <p className='text-muted-foreground text-sm'>{copy.overview.noSearchResults}</p>
                </div>
              ) : (
                filteredTiers.map((tier) => (
                  <BillingTierOverviewCard key={tier.id} copy={copy} locale={locale} tier={tier} />
                ))
              )}
            </div>
          </>
        ) : null}
      </div>
    </AdminPageShell>
  )
}

export function AdminBillingCreateTier() {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().admin.billing
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
          { label: copy.breadcrumbs.admin, href: '/admin' },
          { label: copy.breadcrumbs.billing, href: '/admin/billing' },
          { label: copy.breadcrumbs.createTier },
        ]}
      />
    </div>
  )

  const headerCenter = (
    <TierEditorHeaderCenter copy={copy} locale={locale} previewValues={previewValues} />
  )

  const headerRight = (
    <PrimaryButton form={formId} type='submit' disabled={createTier.isPending}>
      {createTier.isPending ? copy.create.creating : copy.create.submit}
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
        throw new Error(copy.errors.createdTierMissingId)
      }

      router.push(`/admin/billing/${tierId}`)
    } catch (submitError) {
      setError(getErrorMessage(submitError, copy.errors.unknown))
    }
  }

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <TierEditorFormSurface
          copy={copy}
          locale={locale}
          formId={formId}
          initialValues={initialValues}
          previewValues={previewValues}
          sectionState={sectionState}
          onSectionStateChange={(sectionId, open) =>
            setSectionState((current) => ({ ...current, [sectionId]: open }))
          }
          onAccessFieldChange={handleAccessFieldChange}
          isPending={createTier.isPending}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
        />
      </div>
    </AdminPageShell>
  )
}
