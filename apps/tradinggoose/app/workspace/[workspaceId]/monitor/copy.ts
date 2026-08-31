'use client'

import { type Messages, useLocale, useMessages } from 'next-intl'
import { MONITOR_ASSET_TYPES, type MonitorAssetType } from '@/lib/monitors/sources'
import type { MonitorExecutionGroupLabels } from '@/app/workspace/[workspaceId]/monitor/components/data/execution-ordering'
import type {
  ConfigMonitorDimensionField,
  ConfigMonitorStatus,
  ExecutionMonitorGroupField,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'
import type { LocaleCode } from '@/i18n/utils'

export type MonitorCopy = Messages['workspace']['monitor']

type MonitorBoardLabels = {
  allExecutionsLabel: string
  emptyColumnValues: Partial<
    Record<ExecutionMonitorGroupField, Array<{ id: string; label: string; sortValue: string }>>
  >
  groupFieldLabels: Record<ExecutionMonitorGroupField, string>
  groupValueLabels: MonitorExecutionGroupLabels
}

type ConfigBoardLabels = {
  allLabel: string
  emptyDimensionLabels: Record<ConfigMonitorDimensionField, string>
  statusLabels: Record<ConfigMonitorStatus, string>
}

export function useMonitorCopy() {
  const locale = useLocale() as LocaleCode

  return {
    locale,
    copy: useMessages().workspace.monitor,
  }
}

export function getMonitorModeLabel(copy: MonitorCopy, mode: 'executions' | 'config') {
  return mode === 'executions' ? copy.mode.executions : copy.mode.config
}

export function getMonitorOutcomeLabel(copy: MonitorCopy, outcome: string) {
  switch (outcome) {
    case 'running':
      return copy.values.outcomes.running
    case 'success':
      return copy.values.outcomes.success
    case 'error':
      return copy.values.outcomes.error
    case 'skipped':
      return copy.values.outcomes.skipped
    case 'unknown':
      return copy.values.outcomes.unknown
    default:
      return outcome
  }
}

export function getMonitorTriggerLabel(copy: MonitorCopy, trigger: string) {
  switch (trigger) {
    case 'api':
      return copy.values.triggers.api
    case 'manual':
      return copy.values.triggers.manual
    case 'webhook':
      return copy.values.triggers.webhook
    case 'chat':
      return copy.values.triggers.chat
    case 'schedule':
      return copy.values.triggers.schedule
    case 'unknown':
      return copy.values.triggers.unknown
    default:
      return trigger
  }
}

const getMonitorAssetTypeLabels = (copy: MonitorCopy): Record<MonitorAssetType, string> => ({
  stock: copy.values.assetTypes.stock,
  etf: copy.values.assetTypes.etf,
  indice: copy.values.assetTypes.indice,
  mutualfund: copy.values.assetTypes.mutualfund,
  future: copy.values.assetTypes.future,
  crypto: copy.values.assetTypes.crypto,
  currency: copy.values.assetTypes.currency,
  portfolio: copy.values.assetTypes.portfolio,
  unknown: copy.values.assetTypes.unknown,
})

export function getMonitorAssetTypeLabel(copy: MonitorCopy, assetType: string) {
  return getMonitorAssetTypeLabels(copy)[assetType as MonitorAssetType] ?? assetType.toUpperCase()
}

export function getMonitorExecutionGroupLabels(copy: MonitorCopy): MonitorExecutionGroupLabels {
  return {
    outcomeLabels: {
      running: copy.values.outcomes.running,
      success: copy.values.outcomes.success,
      error: copy.values.outcomes.error,
      skipped: copy.values.outcomes.skipped,
      unknown: copy.values.outcomes.unknown,
    },
    triggerLabels: {
      api: copy.values.triggers.api,
      manual: copy.values.triggers.manual,
      webhook: copy.values.triggers.webhook,
      chat: copy.values.triggers.chat,
      schedule: copy.values.triggers.schedule,
      unknown: copy.values.triggers.unknown,
    },
    assetTypeLabels: getMonitorAssetTypeLabels(copy),
    unknownLabel: copy.execution.unknown,
    unknownListingLabel: copy.execution.unknownListing,
    removedMonitorLabel: copy.execution.removedMonitor,
  }
}

export function getMonitorBoardLabels(copy: MonitorCopy): MonitorBoardLabels {
  const groupValueLabels = getMonitorExecutionGroupLabels(copy)

  return {
    allExecutionsLabel: copy.shared.allExecutions,
    groupFieldLabels: {
      outcome: copy.fields.outcome,
      workflow: copy.fields.workflow,
      trigger: copy.fields.trigger,
      listing: copy.fields.listing,
      assetType: copy.fields.assetType,
      provider: copy.fields.provider,
      interval: copy.fields.interval,
      monitor: copy.fields.monitor,
    },
    emptyColumnValues: {
      outcome: [
        {
          id: 'running',
          label: copy.values.outcomes.running,
          sortValue: 'running',
        },
        {
          id: 'error',
          label: copy.values.outcomes.error,
          sortValue: 'error',
        },
        {
          id: 'success',
          label: copy.values.outcomes.success,
          sortValue: 'success',
        },
        {
          id: 'skipped',
          label: copy.values.outcomes.skipped,
          sortValue: 'skipped',
        },
        {
          id: 'unknown',
          label: copy.values.outcomes.unknown,
          sortValue: 'unknown',
        },
      ],
      trigger: [
        { id: 'api', label: copy.values.triggers.api, sortValue: 'api' },
        {
          id: 'manual',
          label: copy.values.triggers.manual,
          sortValue: 'manual',
        },
        {
          id: 'webhook',
          label: copy.values.triggers.webhook,
          sortValue: 'webhook',
        },
        { id: 'chat', label: copy.values.triggers.chat, sortValue: 'chat' },
        {
          id: 'schedule',
          label: copy.values.triggers.schedule,
          sortValue: 'schedule',
        },
        {
          id: 'unknown',
          label: copy.values.triggers.unknown,
          sortValue: 'unknown',
        },
      ],
      assetType: MONITOR_ASSET_TYPES.map((id) => ({
        id,
        label: getMonitorAssetTypeLabel(copy, id),
        sortValue: id,
      })),
    },
    groupValueLabels,
  }
}

export function getConfigBoardLabels(copy: MonitorCopy): ConfigBoardLabels {
  return {
    allLabel: copy.shared.all,
    emptyDimensionLabels: {
      workflowTarget: copy.fields.workflowTarget,
      indicator: copy.fields.indicator,
      listing: copy.fields.listing,
      provider: copy.fields.provider,
      interval: copy.fields.interval,
    },
    statusLabels: {
      active: copy.fields.active,
      paused: copy.fields.paused,
    },
  }
}
