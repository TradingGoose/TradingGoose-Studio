'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
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
  useWorkspaceSettings,
  type WorkspaceBillingOwner,
  workspaceMutationOptions,
} from '@/hooks/queries/workspace'

const logger = createLogger('WorkspaceBillingOwnerEditor')

function getBillingOwnerValue(billingOwner: WorkspaceBillingOwner): string {
  return billingOwner.type === 'organization' ? 'organization' : `user:${billingOwner.userId}`
}

export function WorkspaceBillingOwnerEditor() {
  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const params = useParams<{ workspaceId?: string | string[] }>()
  const workspaceIdParam = params?.workspaceId
  const workspaceId = Array.isArray(workspaceIdParam)
    ? workspaceIdParam[0]
    : (workspaceIdParam ?? '')
  const { data: workspaceSettings, isLoading } = useWorkspaceSettings(workspaceId)
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
          throw new Error('No active organization is available for billing ownership')
        }

        await assignWorkspaceToOrganization.mutateAsync({
          workspaceId: workspace.id,
          organizationId: activeOrganization.id,
        })
        return
      }

      if (!value.startsWith('user:')) {
        throw new Error('Invalid billing owner selection')
      }

      const userId = value.slice('user:'.length)
      if (!userId) {
        throw new Error('Invalid billing owner selection')
      }

      await updateWorkspaceSettings.mutateAsync({
        workspaceId: workspace.id,
        billingOwner: {
          type: 'user',
          userId,
        },
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to update billing owner'
      logger.error('Failed to update workspace billing owner', {
        error: cause,
        workspaceId: workspace.id,
      })
      setError(message)
    } finally {
      changeLockRef.current = false
    }
  }

  return (
    <div className='space-y-3 rounded-sm border bg-background p-4 shadow-xs'>
      <div className='space-y-1'>
        <h4 className='font-medium text-sm'>Billing owner</h4>
        <p className='text-muted-foreground text-xs'>
          Choose which admin account or organization pays for this workspace.
        </p>
      </div>

      {error ? (
        <Alert role='alert' variant='destructive' className='rounded-sm'>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className='space-y-2'>
        <Label htmlFor='workspace-billing-owner' className='font-medium text-sm'>
          Owner
        </Label>
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
              ? [{ value: 'organization', label: activeOrganization.name || 'Organization' }]
              : workspace.billingOwner.type === 'organization'
                ? [{ value: 'organization', label: 'Organization' }]
                : []),
          ]}
          onValueChange={(value) => {
            if (value !== null) void handleChange(value)
          }}
          disabled={isLoading || isPending}
        >
          <SelectTrigger
            id='workspace-billing-owner'
            className='rounded-sm'
            aria-busy={isPending || undefined}
          >
            <SelectValue placeholder='Select billing owner' />
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
                {activeOrganization.name || 'Organization'}
              </SelectItem>
            ) : workspace.billingOwner.type === 'organization' ? (
              <SelectItem value='organization' disabled>
                Organization
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {isPending ? (
          <p role='status' className='text-muted-foreground text-xs'>
            Updating billing owner…
          </p>
        ) : null}
        <p className='text-muted-foreground text-xs'>
          User billing must point at a workspace admin. Organization billing requires an active
          organization billing tier.
        </p>
      </div>
    </div>
  )
}
