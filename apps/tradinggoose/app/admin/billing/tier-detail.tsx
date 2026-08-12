'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Receipt } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { Alert, AlertDescription, Button } from '@/components/ui'
import type { AdminBillingTierMutationInput } from '@/lib/admin/billing/tier-mutations'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { AdminPageShell } from '@/app/admin/page-shell'
import { EmptyStateCard, PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  ADMIN_BILLING_TIERS_ENDPOINT,
  adminBillingKeys,
  sendAdminBillingMutationRequest,
  useAdminBillingSnapshot,
} from '@/hooks/queries/admin-billing'
import { adminSystemSettingsKeys } from '@/hooks/queries/admin-system-settings'
import { useRouter } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'
import {
  BillingBreadcrumbs,
  buildTierMutationInput,
  createTierFormDefaults,
  createTierPreviewState,
  DEFAULT_TIER_EDITOR_SECTIONS,
  getErrorMessage,
  normalizeTierFormDefaults,
  type TierDerivedAccessFields,
  TierEditorFormSurface,
  TierEditorHeaderCenter,
  type TierEditorSectionState,
  type TierFormDefaults,
} from './tier-editor'

function AdminBillingTierDetailEditorPage({ tier }: { tier: AdminBillingTierSnapshot }) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().admin.billing
  const router = useRouter()
  const queryClient = useQueryClient()
  const invalidateTierSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
      queryClient.invalidateQueries({ queryKey: adminSystemSettingsKeys.snapshot() }),
    ])
  }
  const updateTier = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminBillingTierMutationInput }) =>
      sendAdminBillingMutationRequest(`${ADMIN_BILLING_TIERS_ENDPOINT}/${id}`, 'PATCH', input),
    onSuccess: invalidateTierSnapshots,
  })
  const deleteTier = useMutation({
    mutationFn: (id: string) =>
      sendAdminBillingMutationRequest(`${ADMIN_BILLING_TIERS_ENDPOINT}/${id}`, 'DELETE'),
    onSuccess: invalidateTierSnapshots,
  })
  const initialValues = useMemo(() => createTierFormDefaults(tier), [tier])
  const [previewValues, setPreviewValues] = useState<TierFormDefaults>(initialValues)
  const [sectionState, setSectionState] = useState<TierEditorSectionState>({
    ...DEFAULT_TIER_EDITOR_SECTIONS,
  })
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const formId = `admin-billing-tier-form-${tier.id}`

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <BillingBreadcrumbs
        items={[
          { label: copy.breadcrumbs.admin, href: '/admin' },
          { label: copy.breadcrumbs.billing, href: '/admin/billing' },
          { label: tier.displayName },
        ]}
      />
    </div>
  )

  const headerCenter = (
    <TierEditorHeaderCenter
      copy={copy}
      locale={locale}
      previewValues={previewValues}
      extraStats={[
        { label: copy.tierDetail.subscribers, value: String(tier.subscriptionCount) },
        {
          label: copy.tierDetail.workflowExec,
          value: previewValues.workflowExecutionMultiplier
            ? `${previewValues.workflowExecutionMultiplier}x`
            : copy.tierDetail.workflowExecFallback,
        },
        { label: copy.tierDetail.tierId, value: tier.id },
      ]}
    />
  )

  const headerRight = (
    <PrimaryButton
      form={formId}
      type='submit'
      disabled={updateTier.isPending || deleteTier.isPending}
    >
      {updateTier.isPending ? copy.tierDetail.saving : copy.tierDetail.save}
    </PrimaryButton>
  )

  function handleFormChange(event: FormEvent<HTMLFormElement>) {
    setError(null)
    setMessage(null)
    setPreviewValues(createTierPreviewState(new FormData(event.currentTarget)))
  }

  function handleAccessFieldChange(field: keyof TierDerivedAccessFields, value: string) {
    setError(null)
    setMessage(null)
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
    setMessage(null)

    try {
      const input = buildTierMutationInput(new FormData(event.currentTarget))
      await updateTier.mutateAsync({ id: tier.id, input })
      setMessage(copy.tierDetail.updated)
    } catch (submitError) {
      setError(getErrorMessage(submitError, copy.errors.unknown))
    }
  }

  async function handleDelete() {
    setError(null)
    setMessage(null)

    try {
      await deleteTier.mutateAsync(tier.id)
      router.push('/admin/billing')
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, copy.errors.unknown))
    }
  }

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {tier.subscriptionCount > 0 ? (
          <Alert>
            <AlertDescription>{copy.tierDetail.activeSubscriptionsWarning}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Alert role='status'>
            <AlertDescription>{message}</AlertDescription>
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
          isPending={updateTier.isPending || deleteTier.isPending}
          requireStripeMonthlyPriceId={true}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
          footer={
            <div className='flex flex-wrap gap-3'>
              <Button
                type='button'
                variant='outline'
                onClick={handleDelete}
                disabled={deleteTier.isPending || tier.subscriptionCount > 0 || tier.isDefault}
              >
                {deleteTier.isPending ? copy.tierDetail.deleting : copy.tierDetail.delete}
              </Button>
            </div>
          }
        />
      </div>
    </AdminPageShell>
  )
}

export function AdminBillingTierDetail({ tierId }: { tierId: string }) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().admin.billing
  const router = useRouter()
  const snapshotQuery = useAdminBillingSnapshot()
  const snapshot = snapshotQuery.data
  const tier = snapshot?.currentTiers.find((currentTier) => currentTier.id === tierId) ?? null

  if (tier) {
    return <AdminBillingTierDetailEditorPage tier={tier} />
  }

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <BillingBreadcrumbs
        items={[
          { label: copy.breadcrumbs.admin, href: '/admin' },
          { label: copy.breadcrumbs.billing, href: '/admin/billing' },
          { label: copy.breadcrumbs.billingTier },
        ]}
      />
    </div>
  )

  return (
    <AdminPageShell left={headerLeft}>
      <div className='flex flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>
              {getErrorMessage(snapshotQuery.error, copy.errors.unknown)}
            </AlertDescription>
          </Alert>
        ) : null}

        {snapshotQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>{copy.tierDetail.loading}</p>
          </div>
        ) : null}

        {!snapshotQuery.isPending && !tier ? (
          <EmptyStateCard
            title={copy.tierDetail.notFoundTitle}
            description={copy.tierDetail.notFoundDescription}
            actionLabel={copy.tierDetail.notFoundButton}
            onAction={() => router.push('/admin/billing')}
            icon={<Receipt className='h-4 w-4 text-muted-foreground' />}
          />
        ) : null}
      </div>
    </AdminPageShell>
  )
}
