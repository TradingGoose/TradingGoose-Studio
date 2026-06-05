'use client'

import { useLocale, useMessages, type Messages } from 'next-intl'
import type { LocaleCode } from '@/i18n/utils'
import type { MonitorExecutionGroupLabels } from '@/app/workspace/[workspaceId]/monitor/components/data/execution-ordering'
import type {
  ConfigMonitorDimensionField,
  ConfigMonitorStatus,
  ExecutionMonitorGroupField,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'

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

export function getMonitorModeLabel(
  copy: MonitorCopy,
  mode: 'executions' | 'config'
) {
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

export function getMonitorAssetTypeLabel(copy: MonitorCopy, assetType: string) {
  switch (assetType) {
    case 'stock':
      return copy.values.assetTypes.stock
    case 'crypto':
      return copy.values.assetTypes.crypto
    case 'currency':
      return copy.values.assetTypes.currency
    case 'default':
      return copy.values.assetTypes.default
    case 'unknown':
      return copy.values.assetTypes.unknown
    default:
      return assetType.toUpperCase()
  }
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
    assetTypeLabels: {
      stock: copy.values.assetTypes.stock,
      crypto: copy.values.assetTypes.crypto,
      currency: copy.values.assetTypes.currency,
      default: copy.values.assetTypes.default,
      unknown: copy.values.assetTypes.unknown,
    },
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
      assetType: [
        { id: 'stock', label: copy.values.assetTypes.stock, sortValue: 'stock' },
        {
          id: 'crypto',
          label: copy.values.assetTypes.crypto,
          sortValue: 'crypto',
        },
        {
          id: 'currency',
          label: copy.values.assetTypes.currency,
          sortValue: 'currency',
        },
        {
          id: 'default',
          label: copy.values.assetTypes.default,
          sortValue: 'default',
        },
        {
          id: 'unknown',
          label: copy.values.assetTypes.unknown,
          sortValue: 'unknown',
        },
      ],
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
