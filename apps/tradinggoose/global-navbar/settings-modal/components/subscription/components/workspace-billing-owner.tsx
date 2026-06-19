'use client'

import { useState } from 'react'
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
  useAssignWorkspaceToOrganization,
  useOrganizationBilling,
  useOrganizations,
} from '@/hooks/queries/organization'
import {
  useUpdateWorkspaceSettings,
  useWorkspaceSettings,
  type WorkspaceBillingOwner,
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
  const updateWorkspaceSettings = useUpdateWorkspaceSettings()
  const [error, setError] = useState<string | null>(null)

  const workspace = workspaceSettings?.settings?.workspace
  const currentValue = workspace ? getBillingOwnerValue(workspace.billingOwner) : ''
  const admins =
    workspaceSettings?.permissions?.users?.filter((user) => user.permissionType === 'admin') ?? []
  const activeOrganization = organizationsData?.activeOrganization ?? null
  const { data: organizationBilling } = useOrganizationBilling(activeOrganization?.id || '')
  const currentOwnerUser = admins.find((admin) => `user:${admin.userId}` === currentValue) ?? null
  const assignWorkspaceToOrganization = useAssignWorkspaceToOrganization()
  const canAssignOrganizationBilling = Boolean(
    organizationBilling?.subscriptionTier?.ownerType === 'organization'
  )

  if (!workspace || workspace.permissions !== 'admin' || !session?.user?.id) {
    return null
  }

  const handleChange = async (value: string) => {
    if (value === currentValue) {
      return
    }

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
        <Alert variant='destructive' className='rounded-sm'>
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
          onValueChange={handleChange}
          disabled={
            isLoading ||
            updateWorkspaceSettings.isPending ||
            assignWorkspaceToOrganization.isPending
          }
        >
          <SelectTrigger id='workspace-billing-owner' className='rounded-sm'>
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
        <p className='text-muted-foreground text-xs'>
          User billing must point at a workspace admin. Organization billing requires an active
          organization billing tier.
        </p>
      </div>
    </div>
  )
}
