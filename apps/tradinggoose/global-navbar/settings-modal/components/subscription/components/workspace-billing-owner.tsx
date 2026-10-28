'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import {
  organizationMutationOptions,
  useOrganizationBilling,
  useOrganizations,
} from '@/hooks/queries/organization'
import {
  type WorkspaceBillingOwner,
  type WorkspaceSettingsResponse,
  workspaceMutationOptions,
} from '@/hooks/queries/workspace'

const logger = createLogger('WorkspaceBillingOwnerEditor')

function getBillingOwnerValue(billingOwner: WorkspaceBillingOwner): string {
  return billingOwner.type === 'organization' ? 'organization' : `user:${billingOwner.userId}`
}

interface WorkspaceBillingOwnerEditorProps {
  isLoading: boolean
  workspaceSettings: WorkspaceSettingsResponse | undefined
}

export function WorkspaceBillingOwnerEditor({
  isLoading,
  workspaceSettings,
}: WorkspaceBillingOwnerEditorProps) {
  const copy = useTranslations('workspace.settingsModal.subscription.billingOwner')
  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const [error, setError] = useState<string | null>(null)
  const changeLockRef = useRef(false)
  const queryClient = useQueryClient()
  const updateWorkspaceSettings = useMutation(workspaceMutationOptions.updateSettings(queryClient))

  const workspace = workspaceSettings?.settings?.workspace
  const currentValue = workspace ? getBillingOwnerValue(workspace.billingOwner) : ''
  const admins =
    workspaceSettings?.permissions?.users?.filter((user) => user.permissionType === 'admin') ?? []
  const activeOrganization = organizationsData?.activeOrganization ?? null
  const { data: organizationBilling } = useOrganizationBilling(activeOrganization?.id || '')
  const currentOwnerUser = admins.find((admin) => `user:${admin.userId}` === currentValue) ?? null
  const assignWorkspaceToOrganization = useMutation(
    organizationMutationOptions.assignWorkspace(queryClient)
  )
  const isPending = updateWorkspaceSettings.isPending || assignWorkspaceToOrganization.isPending
  const canAssignOrganizationBilling = Boolean(
    organizationBilling?.organizationId === activeOrganization?.id &&
      organizationBilling?.subscriptionTier?.ownerType === 'organization'
  )

  if (!workspace || workspace.permissions !== 'admin' || !session?.user?.id) {
    return null
  }

  const handleChange = async (value: string) => {
    if (value === currentValue || changeLockRef.current || isPending) return

    changeLockRef.current = true
    setError(null)

    try {
      if (value === 'organization') {
        if (!activeOrganization?.id) {
          setError(copy('noActiveOrganization'))
          return
        }

        await assignWorkspaceToOrganization.mutateAsync({
          workspaceId: workspace.id,
          organizationId: activeOrganization.id,
        })
        return
      }

      const userId = value.slice('user:'.length)
      if (!value.startsWith('user:') || !userId) {
        setError(copy('invalidSelection'))
        return
      }

      await updateWorkspaceSettings.mutateAsync({
        workspaceId: workspace.id,
        billingOwner: {
          type: 'user',
          userId,
        },
      })
    } catch (cause) {
      logger.error('Failed to update workspace billing owner', {
        error: cause,
        workspaceId: workspace.id,
      })
      setError(copy('failedToUpdate'))
    } finally {
      changeLockRef.current = false
    }
  }

  return (
    <div className='space-y-3 rounded-sm border bg-background p-4 shadow-xs'>
      <div className='space-y-1'>
        <h4 id='workspace-billing-owner-title' className='font-medium text-sm'>
          {copy('title')}
        </h4>
        <p className='text-muted-foreground text-xs'>{copy('description')}</p>
      </div>

      {error ? (
        <Alert role='alert' variant='destructive' className='rounded-sm'>
          <AlertTitle>{copy('error')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className='space-y-2'>
        <Select
          value={currentValue}
          items={[
            ...admins.map((admin) => ({
              value: `user:${admin.userId}`,
              label: admin.name || admin.email || admin.userId,
            })),
            ...(workspace.billingOwner.type === 'user' && !currentOwnerUser
              ? [{ value: currentValue, label: workspace.billingOwner.userId }]
              : []),
            ...(activeOrganization?.id
              ? [{ value: 'organization', label: activeOrganization.name || copy('organization') }]
              : workspace.billingOwner.type === 'organization'
                ? [{ value: 'organization', label: copy('organization') }]
                : []),
          ]}
          onValueChange={(value) => {
            if (value !== null) void handleChange(value)
          }}
          disabled={isLoading || isPending}
        >
          <SelectTrigger
            id='workspace-billing-owner'
            aria-labelledby='workspace-billing-owner-title'
            className='rounded-sm'
            aria-busy={isPending || undefined}
          >
            <SelectValue placeholder={copy('selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {admins.map((admin) => (
              <SelectItem key={admin.userId} value={`user:${admin.userId}`}>
                {admin.name || admin.email || admin.userId}
              </SelectItem>
            ))}
            {workspace.billingOwner.type === 'user' && !currentOwnerUser ? (
              <SelectItem value={currentValue} disabled>
                {workspace.billingOwner.userId}
              </SelectItem>
            ) : null}
            {activeOrganization?.id ? (
              <SelectItem value='organization' disabled={!canAssignOrganizationBilling}>
                {activeOrganization.name || copy('organization')}
              </SelectItem>
            ) : workspace.billingOwner.type === 'organization' ? (
              <SelectItem value='organization' disabled>
                {copy('organization')}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {isPending ? (
          <p role='status' className='text-muted-foreground text-xs'>
            {copy('updating')}
          </p>
        ) : null}
        <p className='text-muted-foreground text-xs'>{copy('billingNotice')}</p>
      </div>
    </div>
  )
}
