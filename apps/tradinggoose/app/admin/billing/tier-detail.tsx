'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { Alert, AlertDescription, Button } from '@/components/ui'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { AdminPageShell } from '@/app/admin/page-shell'
import { EmptyStateCard, PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useAdminBillingSnapshot, useUpdateAdminBillingTier } from '@/hooks/queries/admin-billing'
import { useRouter } from '@/i18n/navigation'
import type { LocaleCode } from '@/i18n/utils'
import {
  BillingBreadcrumbs,
  buildTierMutationInput,
  buildTierMutationInputFromDefaults,
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
  const updateTier = useUpdateAdminBillingTier()
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
        {
          label: copy.editor.limits.workflowExecutionTimeLimit,
          value: previewValues.workflowExecutionTimeLimitSeconds
            ? `${previewValues.workflowExecutionTimeLimitSeconds}s`
            : copy.editor.limits.workflowExecutionTimeLimitUnlimited,
        },
        { label: copy.tierDetail.tierId, value: tier.id },
      ]}
    />
  )

  const headerRight = (
    <PrimaryButton form={formId} type='submit' disabled={updateTier.isPending}>
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

  async function handleArchive() {
    setError(null)
    setMessage(null)

    try {
      await updateTier.mutateAsync({
        id: tier.id,
        input: buildTierMutationInputFromDefaults({
          ...createTierFormDefaults(tier),
          status: 'archived',
        }),
      })
      setMessage(copy.tierDetail.updated)
    } catch (archiveError) {
      setError(getErrorMessage(archiveError, copy.errors.unknown))
    }
  }

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {tier.entitledSubscriptionCount > 0 ? (
          <Alert>
            <AlertDescription>{copy.tierDetail.activeSubscriptionsWarning}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Alert>
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
          disabled={updateTier.isPending}
          onSubmit={handleSubmit}
          onFormChange={handleFormChange}
          footer={
            <div className='flex flex-wrap gap-3'>
              <Button
                type='button'
                variant='outline'
                onClick={handleArchive}
                disabled={updateTier.isPending || tier.archiveAction !== 'archive'}
              >
                {copy.tierDetail.archive}
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
          <Alert variant='destructive'>
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
