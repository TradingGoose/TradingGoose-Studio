import type { ComponentType } from 'react'
import type { ListingIdentity } from '@/lib/listing/identity'

export type IndicatorOption = {
  id: string
  name: string
  source: 'default' | 'custom'
  color: string
}

export type WorkflowTargetOption = {
  workflowId: string
  blockId: string
  workflowName: string
  workflowColor: string
  isDeployed: boolean
  blockName: string
  label: string
}

export type IndicatorMonitorRecord = {
  monitorId: string
  workflowId: string
  blockId: string
  isActive: boolean
  providerConfig: {
    triggerId: 'indicator_trigger'
    version: 1
    monitor: {
      providerId: string
      interval: string
      listing: ListingIdentity
      indicatorId: string
      auth?: {
        hasEncryptedSecrets?: boolean
        encryptedSecretFieldIds?: string[]
        secretReferences?: Record<string, string>
      }
      providerParams?: Record<string, unknown>
    }
  }
  createdAt: string
  updatedAt: string
}

export type MonitorDraft = {
  workflowId: string
  blockId: string
  providerId: string
  interval: string
  indicatorId: string
  listing: ListingIdentity | null
  secretValues: Record<string, string>
  providerParamValues: Record<string, string>
  existingEncryptedSecretFieldIds: string[]
  isActive: boolean
}

export type IndicatorMonitorMutationInput = {
  workspaceId: string
  workflowId: string
  blockId: string
  providerId: string
  interval: string
  indicatorId: string
  listing: ListingIdentity
  auth: {
    secrets: Record<string, string>
  }
  providerParams?: Record<string, string>
  isActive: boolean
}

export type IndicatorMonitorStateUpdateInput = {
  workspaceId: string
  isActive: boolean
}

export type StreamingProviderOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

export type WorkflowPickerOption = {
  workflowId: string
  workflowName: string
  workflowColor: string
}
