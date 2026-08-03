import {
  MONITOR_DOCUMENT_FORMAT,
  readMonitorDocumentName,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'
import {
  INDICATOR_MONITOR_PROVIDER,
  type MonitorWebhookProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'

export type MonitorRecord = {
  monitorId: string
  source: MonitorWebhookProvider
  workflowId: string
  blockId: string
  isActive: boolean
  providerConfig: {
    monitor: {
      providerId: string
      interval?: string
      listing?: ListingIdentity
      indicatorId?: string
      serviceId?: string
      credentialId?: string
      accountId?: string
      condition?: unknown
      fireMode?: 'edge' | 'while_true'
      cooldownSeconds?: number
      pollIntervalSeconds?: number
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

export function toMonitorDocumentFields(record: MonitorRecord) {
  const monitor = record.providerConfig.monitor
  if (record.source === PORTFOLIO_MONITOR_PROVIDER) {
    return {
      source: PORTFOLIO_MONITOR_PROVIDER,
      workflowId: record.workflowId,
      blockId: record.blockId,
      providerId: monitor.providerId,
      serviceId: monitor.serviceId,
      credentialId: monitor.credentialId,
      accountId: monitor.accountId,
      condition: monitor.condition,
      fireMode: monitor.fireMode,
      cooldownSeconds: monitor.cooldownSeconds,
      pollIntervalSeconds: monitor.pollIntervalSeconds,
      isActive: record.isActive,
    }
  }

  return {
    source: INDICATOR_MONITOR_PROVIDER,
    workflowId: record.workflowId,
    blockId: record.blockId,
    providerId: monitor.providerId,
    interval: monitor.interval,
    indicatorId: monitor.indicatorId,
    listing: monitor.listing,
    isActive: record.isActive,
    ...(monitor.providerParams ? { providerParams: monitor.providerParams } : {}),
  }
}

export async function resolveMonitorListingPresentation(
  listing: ListingIdentity | undefined,
  signal?: AbortSignal
): Promise<ListingResolved | null> {
  if (!listing) return null
  const resolved = await resolveListingIdentities([listing], signal)
  return resolved[getListingIdentityKey(listing)] ?? null
}

export function buildMonitorDocumentEnvelope(
  record: MonitorRecord,
  resolvedListing: ListingResolved | null,
  success?: boolean
) {
  const fields = toMonitorDocumentFields(record)
  return {
    ...(success === undefined ? {} : { success }),
    surfaceKind: 'monitor' as const,
    monitorId: record.monitorId,
    monitorName: readMonitorDocumentName(fields, resolvedListing),
    documentFormat: MONITOR_DOCUMENT_FORMAT,
    monitorDocument: serializeMonitorDocument(fields),
  }
}

export function buildMonitorListEntry(
  record: MonitorRecord,
  resolvedListing: ListingResolved | null
) {
  const monitor = record.providerConfig.monitor
  return {
    monitorId: record.monitorId,
    monitorName: readMonitorDocumentName(toMonitorDocumentFields(record), resolvedListing),
    monitorDescription: `Workflow ${record.workflowId}, block ${record.blockId}`,
    workflowId: record.workflowId,
    blockId: record.blockId,
    source: record.source,
    providerId: monitor.providerId,
    ...(monitor.indicatorId ? { indicatorId: monitor.indicatorId } : {}),
    ...(monitor.interval ? { interval: monitor.interval } : {}),
    ...(monitor.serviceId ? { serviceId: monitor.serviceId } : {}),
    ...(monitor.credentialId ? { credentialId: monitor.credentialId } : {}),
    ...(monitor.accountId ? { accountId: monitor.accountId } : {}),
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
