'use client'

import { type FormEvent, useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, Button } from '@/components/ui'
import type { AdminBillingTierSnapshot } from '@/lib/admin/billing/types'
import { AdminPageShell } from '@/app/admin/page-shell'
import { EmptyStateCard, PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  useAdminBillingSnapshot,
  useDeleteAdminBillingTier,
  useUpdateAdminBillingTier,
} from '@/hooks/queries/admin-billing'
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
  const router = useRouter()
  const updateTier = useUpdateAdminBillingTier()
  const deleteTier = useDeleteAdminBillingTier()
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
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: tier.displayName },
        ]}
      />
    </div>
  )

  const headerCenter = (
    <TierEditorHeaderCenter
      previewValues={previewValues}
      extraStats={[
        { label: 'Subscribers', value: String(tier.subscriptionCount) },
        {
          label: 'Workflow Exec',
          value: previewValues.workflowExecutionMultiplier
            ? `${previewValues.workflowExecutionMultiplier}x`
            : '1x',
        },
        { label: 'Tier ID', value: tier.id },
      ]}
    />
  )

  const headerRight = (
    <PrimaryButton
      form={formId}
      type='submit'
      disabled={updateTier.isPending || deleteTier.isPending}
    >
      {updateTier.isPending ? 'Saving…' : 'Save Tier'}
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
      setMessage('Tier updated')
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    }
  }

  async function handleDelete() {
    setError(null)
    setMessage(null)

    try {
      await deleteTier.mutateAsync(tier.id)
      router.push('/admin/billing')
    } catch (deleteError) {
      setError(getErrorMessage(deleteError))
    }
  }

  return (
    <AdminPageShell left={headerLeft} center={headerCenter} right={headerRight}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {tier.subscriptionCount > 0 ? (
          <Alert>
            <AlertDescription>
              This tier has active subscriptions. Delete is disabled until they are moved off.
            </AlertDescription>
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
          formId={formId}
          initialValues={initialValues}
          previewValues={previewValues}
          sectionState={sectionState}
          onSectionStateChange={(sectionId, open) =>
            setSectionState((current) => ({ ...current, [sectionId]: open }))
          }
          onAccessFieldChange={handleAccessFieldChange}
          disabled={updateTier.isPending || deleteTier.isPending}
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
                Delete Tier
              </Button>
            </div>
          }
        />
      </div>
    </AdminPageShell>
  )
}

export function AdminBillingTierDetail({ tierId }: { tierId: string }) {
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
          { label: 'Admin', href: '/admin' },
          { label: 'Billing', href: '/admin/billing' },
          { label: 'Billing tier' },
        ]}
      />
    </div>
  )

  return (
    <AdminPageShell left={headerLeft}>
      <div className='flex flex-col gap-4'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(snapshotQuery.error)}</AlertDescription>
          </Alert>
        ) : null}

        {snapshotQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>Loading billing tier...</p>
          </div>
        ) : null}

        {!snapshotQuery.isPending && !tier ? (
          <EmptyStateCard
            title='Tier not found'
            description='Go back to billing and choose a different tier.'
            buttonText='Back to Billing'
            onClick={() => router.push('/admin/billing')}
            icon={<Receipt className='h-4 w-4 text-muted-foreground' />}
          />
        ) : null}
      </div>
    </AdminPageShell>
  )
}
