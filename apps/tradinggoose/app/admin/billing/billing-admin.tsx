'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Plus, Receipt } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import {
  BillingBreadcrumbs,
  buildTierMutationInput,
  createTierFormDefaults,
  createTierPreviewState,
  DEFAULT_TIER_EDITOR_SECTIONS,
  FieldShell,
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
                    Platform charges applied before tier-specific multipliers. Workflows are
                    billed per run, and functions are billed per second of execution time.
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
                    label='Function Runtime Rate USD'
                    hint='Charged per second of function execution before tier multipliers.'
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
                  Manage registration, billing activation, and promotion codes from the system
                  settings section on the main admin page. Stripe credentials stay deployment-owned
                  in env.
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
        <span className='text-[11px] text-muted-foreground'>Rates</span>
        <span className='font-medium text-[11px] text-foreground'>
          Workflow/run ${snapshot.workflowExecutionChargeUsd} • Function/sec $
          {snapshot.functionExecutionChargeUsd}
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
          requireStripeMonthlyPriceId={true}
          disabled={createTier.isPending}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
        />
      </div>
    </AdminPageShell>
  )
}
