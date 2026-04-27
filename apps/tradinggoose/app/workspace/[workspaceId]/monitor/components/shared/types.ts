import type { ComponentType } from 'react'
import type { InputMetaMap } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'

export type IndicatorOption = {
  id: string
  name: string
  source: 'default' | 'custom'
  color: string
  inputTitles?: string[]
  inputMeta?: InputMetaMap
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
      indicatorInputs?: Record<string, unknown>
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
  indicatorInputs: Record<string, unknown>
  existingEncryptedSecretFieldIds: string[]
  isActive: boolean
}

export type IndicatorMonitorCreateInput = {
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
  indicatorInputs?: Record<string, unknown>
  isActive: boolean
}

export type IndicatorMonitorUpdateInput = {
  workspaceId: string
  workflowId?: string
  blockId?: string
  providerId?: string
  interval?: string
  indicatorId?: string
  listing?: ListingIdentity
  auth?: {
    secrets: Record<string, string>
  }
  providerParams?: Record<string, string>
  indicatorInputs?: Record<string, unknown>
  isActive?: boolean
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

export type MonitorReferenceData = {
  workflowTargets: WorkflowTargetOption[]
  workflowTargetByKey: Record<string, WorkflowTargetOption>
  workflowOptions: WorkflowPickerOption[]
  indicatorOptions: IndicatorOption[]
  indicatorById: Record<string, IndicatorOption>
  streamingProviders: StreamingProviderOption[]
  providerById: Record<string, StreamingProviderOption>
  providerIntervalsByProviderId: Record<string, string[]>
  providerParamDefinitionsByProviderId: Record<string, MarketProviderParamDefinition[]>
  defaultDraftProviderId: string
  defaultDraftInterval: string
  createDisabledReason: string | null
  isLoading: boolean
  warning: string | null
}

export type MonitorRecordMutationOptions = {
  optimisticRecord?: IndicatorMonitorRecord
}

export type MonitorRecordActions = {
  createMonitor: (
    input: IndicatorMonitorCreateInput
  ) => Promise<IndicatorMonitorRecord | null>
  updateMonitor: (
    monitorId: string,
    input: IndicatorMonitorUpdateInput,
    options?: MonitorRecordMutationOptions
  ) => Promise<IndicatorMonitorRecord | null>
  toggleMonitorState: (
    monitor: IndicatorMonitorRecord,
    nextIsActive: boolean,
    options?: MonitorRecordMutationOptions
  ) => Promise<IndicatorMonitorRecord | null>
  deleteMonitor: (monitorId: string) => Promise<void>
}
