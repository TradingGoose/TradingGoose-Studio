import { Building2, UserRound } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { OrganizationWorkspaceRecord } from '@/hooks/queries/organization'
import { formatLocalizedNumber } from '@/i18n/formatters'

interface WorkspaceBillingProps {
  billedWorkspaces: OrganizationWorkspaceRecord[]
  availableWorkspaces: OrganizationWorkspaceRecord[]
  canManage: boolean
  hasOrganizationBilling: boolean
  isLoading: boolean
  isPending: boolean
  pendingAction?: string | null
  error?: string | null
  onAssignWorkspace: (workspaceId: string) => Promise<void>
  onReleaseWorkspace: (workspaceId: string) => Promise<void>
}

function WorkspaceBillingSkeleton() {
  return (
    <div className='rounded-sm border bg-background p-4 shadow-xs'>
      <div className='space-y-3'>
        <Skeleton className='h-5 w-36' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-12 w-full' />
        <Skeleton className='h-12 w-full' />
      </div>
    </div>
  )
}

function WorkspaceRow(props: {
  workspace: OrganizationWorkspaceRecord
  actionLabel: string
  actionDisabled?: boolean
  isActive?: boolean
  actionVariant?: 'default' | 'outline'
  onAction: (workspaceId: string) => Promise<void>
}) {
  const copy = useTranslations('workspace.settingsModal.team.billing')
  const {
    workspace,
    actionLabel,
    actionDisabled = false,
    isActive = false,
    actionVariant = 'default',
    onAction,
  } = props

  return (
    <div className='flex items-center justify-between gap-3 rounded-sm border bg-muted/30 p-3'>
      <div className='min-w-0 space-y-1'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium text-sm'>{workspace.name}</span>
          {workspace.billingOwner.type === 'organization' ? (
            <span className='inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700'>
              <Building2 className='h-3 w-3' />
              {copy('organization')}
            </span>
          ) : (
            <span className='inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
              <UserRound className='h-3 w-3' />
              {copy('ownerBilling')}
            </span>
          )}
        </div>
        <p className='truncate text-muted-foreground text-xs'>
          {workspace.ownerName || workspace.ownerId}
        </p>
      </div>
      <Button
        type='button'
        size='sm'
        variant={actionVariant}
        disabled={actionDisabled}
        focusableWhenDisabled={isActive}
        aria-busy={isActive || undefined}
        className='h-8 rounded-sm'
        onClick={() => void onAction(workspace.id)}
      >
        {actionLabel}
      </Button>
    </div>
  )
}

export function WorkspaceBilling({
  billedWorkspaces,
  availableWorkspaces,
  canManage,
  hasOrganizationBilling,
  isLoading,
  isPending,
  pendingAction,
  error,
  onAssignWorkspace,
  onReleaseWorkspace,
}: WorkspaceBillingProps) {
  const copy = useTranslations('workspace.settingsModal.team.billing')
  const locale = useLocale()
  if (!canManage) {
    return null
  }

  if (isLoading) {
    return <WorkspaceBillingSkeleton />
  }

  return (
    <div className='space-y-4 rounded-sm border bg-background p-4 shadow-xs'>
      <div className='space-y-1'>
        <h4 className='font-medium text-sm'>{copy('title')}</h4>
        <p className='text-muted-foreground text-xs'>{copy('description')}</p>
      </div>

      {!hasOrganizationBilling ? (
        <div className='rounded-sm border border-dashed bg-muted/30 p-3 text-muted-foreground text-xs'>
          {copy('organizationBillingRequired')}
        </div>
      ) : null}

      {error ? (
        <p role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      ) : null}

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <h5 className='font-medium text-sm'>{copy('organizationBilledTitle')}</h5>
          <span className='text-muted-foreground text-xs'>
            {formatLocalizedNumber(locale, billedWorkspaces.length)}
          </span>
        </div>
        {billedWorkspaces.length === 0 ? (
          <div className='rounded-sm border border-dashed bg-muted/20 p-3 text-muted-foreground text-xs'>
            {copy('organizationBilledEmpty')}
          </div>
        ) : (
          <div className='space-y-2'>
            {billedWorkspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                actionLabel={
                  pendingAction === `release:${workspace.id}`
                    ? copy('returning')
                    : copy('returnToOwner')
                }
                actionVariant='outline'
                actionDisabled={isPending}
                isActive={pendingAction === `release:${workspace.id}`}
                onAction={onReleaseWorkspace}
              />
            ))}
          </div>
        )}
      </div>

      <div className='space-y-2'>
        <div className='flex items-center justify-between'>
          <h5 className='font-medium text-sm'>{copy('availableOwnerBilledTitle')}</h5>
          <span className='text-muted-foreground text-xs'>
            {formatLocalizedNumber(locale, availableWorkspaces.length)}
          </span>
        </div>
        {availableWorkspaces.length === 0 ? (
          <div className='rounded-sm border border-dashed bg-muted/20 p-3 text-muted-foreground text-xs'>
            {copy('availableOwnerBilledEmpty')}
          </div>
        ) : (
          <div className='space-y-2'>
            {availableWorkspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                actionLabel={
                  pendingAction === `assign:${workspace.id}`
                    ? copy('assigning')
                    : copy('billToOrganization')
                }
                actionDisabled={!hasOrganizationBilling || isPending}
                isActive={pendingAction === `assign:${workspace.id}`}
                onAction={onAssignWorkspace}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
