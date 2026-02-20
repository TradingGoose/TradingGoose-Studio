import type { ComponentType } from 'react'
import type { ListingIdentity } from '@/lib/listing/identity'

export const LOGS_PER_PAGE = 50

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

export type MonitorExportContext = {
  workflowId: string
  monitorId: string
  listing: ListingIdentity
  indicatorId: string
  providerId: string
  interval: string
  triggerSource: 'indicator_trigger'
}

export type MonitorsViewProps = {
  workspaceId: string
  timeRange: string
  level: string
  searchQuery: string
  live: boolean
  onRefreshHandleChange: (handler: (() => Promise<void>) | null) => void
  onAddMonitorHandleChange: (handler: (() => void) | null) => void
  onExportContextChange: (context: MonitorExportContext | null) => void
  onRefreshingChange: (refreshing: boolean) => void
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
