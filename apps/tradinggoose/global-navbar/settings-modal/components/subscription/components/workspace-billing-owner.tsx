'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
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
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

const logger = createLogger('WorkspaceBillingOwnerEditor')

function getBillingOwnerValue(billingOwner: WorkspaceBillingOwner): string {
  return billingOwner.type === 'organization' ? 'organization' : `user:${billingOwner.userId}`
}

export function WorkspaceBillingOwnerEditor() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.settingsModal.subscription.billingOwner
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
          throw new Error(copy.noActiveOrganization)
        }

        await assignWorkspaceToOrganization.mutateAsync({
          workspaceId: workspace.id,
          organizationId: activeOrganization.id,
        })
        return
      }

      if (!value.startsWith('user:')) {
        throw new Error(copy.invalidSelection)
      }

      const userId = value.slice('user:'.length)
      if (!userId) {
        throw new Error(copy.invalidSelection)
      }

      await updateWorkspaceSettings.mutateAsync({
        workspaceId: workspace.id,
        billingOwner: {
          type: 'user',
          userId,
        },
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.failedToUpdate
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
        <h4 className='font-medium text-sm'>{copy.title}</h4>
        <p className='text-muted-foreground text-xs'>{copy.description}</p>
      </div>

      {error ? (
        <Alert variant='destructive' className='rounded-sm'>
          <AlertTitle>{copy.error}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className='space-y-2'>
        <Label htmlFor='workspace-billing-owner' className='font-medium text-sm'>
          {copy.ownerLabel}
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
            <SelectValue placeholder={copy.selectPlaceholder} />
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
                {activeOrganization.name || copy.organization}
              </SelectItem>
            ) : workspace.billingOwner.type === 'organization' ? (
              <SelectItem value='organization' disabled>
                {copy.organization}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          {copy.billingNotice}
        </p>
      </div>
    </div>
  )
}
