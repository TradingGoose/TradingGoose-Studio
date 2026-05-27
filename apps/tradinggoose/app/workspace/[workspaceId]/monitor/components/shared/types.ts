import type { ComponentType } from 'react'
import type { InputMetaMap } from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { PortfolioFireCondition } from '@/lib/monitors/portfolio-conditions'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'

export type MonitorSource = 'indicator' | 'portfolio'

export type IndicatorOption = {
  id: string
  name: string
  source: 'default' | 'custom'
  color: string
  inputTitles?: string[]
  inputMeta?: InputMetaMap
}

export type WorkflowTargetOption = {
  source: MonitorSource
  triggerId: 'indicator_trigger' | 'portfolio_state_trigger'
  workflowId: string
  blockId: string
  workflowName: string
  workflowColor: string
  isDeployed: boolean
  blockName: string
  label: string
}

export type MonitorRecord = {
  monitorId: string
  source: MonitorSource
  workflowId: string
  blockId: string
  isActive: boolean
  providerConfig: {
    triggerId: 'indicator_trigger' | 'portfolio_state_trigger'
    version: 1
    monitor: {
      providerId: string
      interval?: string
      listing?: ListingIdentity
      indicatorId?: string
      serviceId?: string
      credentialId?: string
      accountId?: string
      condition?: PortfolioFireCondition
      fireMode?: 'edge' | 'while_true'
      cooldownSeconds?: number
      pollIntervalSeconds?: number
      indicatorInputs?: Record<string, unknown>
      auth?: {
        hasEncryptedSecrets?: boolean
        encryptedSecretFieldIds?: string[]
      }
      providerParams?: Record<string, unknown>
    }
  }
  createdAt: string
  updatedAt: string
}

export type MonitorDraft = {
  source: MonitorSource
  workflowId: string
  blockId: string
  providerId: string
  interval: string
  indicatorId: string
  listing: ListingIdentity | null
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioFireCondition
  fireMode: 'edge' | 'while_true'
  cooldownSeconds: number
  pollIntervalSeconds: number
  secretValues: Record<string, string>
  providerParamValues: Record<string, string>
  indicatorInputs: Record<string, unknown>
  existingEncryptedSecretFieldIds: string[]
  isActive: boolean
}

export type IndicatorMonitorCreateInput = {
  source: 'indicator'
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
  source?: 'indicator'
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

export type PortfolioMonitorCreateInput = {
  source: 'portfolio'
  workspaceId: string
  workflowId: string
  blockId: string
  providerId: string
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioFireCondition
  fireMode: 'edge' | 'while_true'
  cooldownSeconds: number
  pollIntervalSeconds: number
  isActive: boolean
}

export type PortfolioMonitorUpdateInput = {
  source?: 'portfolio'
  workspaceId: string
  workflowId?: string
  blockId?: string
  providerId?: string
  serviceId?: string
  credentialId?: string
  accountId?: string
  condition?: PortfolioFireCondition
  fireMode?: 'edge' | 'while_true'
  cooldownSeconds?: number
  pollIntervalSeconds?: number
  isActive?: boolean
}

export type MonitorCreateInput = IndicatorMonitorCreateInput | PortfolioMonitorCreateInput
export type MonitorUpdateInput = IndicatorMonitorUpdateInput | PortfolioMonitorUpdateInput

export type StreamingProviderOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

export type TradingProviderOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

export type PortfolioAccountOption = {
  id: string
  label: string
  rightLabel?: string
  value: PortfolioIdentity
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
  indicatorWorkflowTargets: WorkflowTargetOption[]
  portfolioWorkflowTargets: WorkflowTargetOption[]
  indicatorOptions: IndicatorOption[]
  indicatorById: Record<string, IndicatorOption>
  streamingProviders: StreamingProviderOption[]
  providerById: Record<string, StreamingProviderOption>
  providerIntervalsByProviderId: Record<string, string[]>
  providerParamDefinitionsByProviderId: Record<string, MarketProviderParamDefinition[]>
  tradingProviders: TradingProviderOption[]
  tradingProviderById: Record<string, TradingProviderOption>
  defaultDraftProviderId: string
  defaultPortfolioProviderId: string
  defaultDraftInterval: string
  createDisabledReason: string | null
  isLoading: boolean
  warning: string | null
}

type MonitorRecordMutationOptions = {
  optimisticRecord?: MonitorRecord
}

export type MonitorRecordActions = {
  createMonitor: (input: MonitorCreateInput) => Promise<MonitorRecord | null>
  updateMonitor: (
    monitorId: string,
    input: MonitorUpdateInput,
    options?: MonitorRecordMutationOptions
  ) => Promise<MonitorRecord | null>
  toggleMonitorState: (
    monitor: MonitorRecord,
    nextIsActive: boolean,
    options?: MonitorRecordMutationOptions
  ) => Promise<MonitorRecord | null>
  deleteMonitor: (monitorId: string) => Promise<void>
}
