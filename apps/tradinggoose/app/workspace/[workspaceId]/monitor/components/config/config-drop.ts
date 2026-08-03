import { ListingIdentitySchema } from '@/lib/listing/identity'
import type { MonitorDraft, MonitorReferenceData, MonitorUpdateInput } from '../shared/types'
import type { ConfigMonitorViewConfig } from '../view/view-config'
import type { ConfigBoardContext } from './config-board-state'
import type { ConfigMonitorCard } from './config-card-model'
import {
  addMonitorDraftIssue,
  getProviderIntervalFallback,
  type MonitorDraftIssues,
} from './config-draft'

type ConfigDropResolution = {
  draftPatch: Partial<MonitorDraft>
  updatePatch: Partial<MonitorUpdateInput>
  issues: MonitorDraftIssues
}

const applyDimension = ({
  draftPatch,
  issues,
  field,
  value,
  referenceData,
}: {
  draftPatch: Partial<MonitorDraft>
  issues: MonitorDraftIssues
  field: string
  value: string
  referenceData: MonitorReferenceData
}) => {
  if (field === 'workflowTarget') {
    const target = referenceData.workflowTargetByKey[value]
    if (!target) {
      addMonitorDraftIssue(issues, 'workflowTarget', 'Workflow target is unavailable.')
      return
    }
    draftPatch.workflowId = target.workflowId
    draftPatch.blockId = target.blockId
    return
  }

  if (field === 'indicator') {
    if (!referenceData.indicatorById[value]) {
      addMonitorDraftIssue(issues, 'indicatorId', 'Indicator is unavailable.')
      return
    }
    draftPatch.indicatorId = value
    draftPatch.indicatorInputs = {}
    return
  }

  if (field === 'provider') {
    if (!referenceData.marketProviderById[value]) {
      addMonitorDraftIssue(issues, 'providerId', 'Provider is unavailable.')
      return
    }
    draftPatch.providerId = value
    return
  }

  if (field === 'interval') {
    draftPatch.interval = value
    return
  }

  if (field === 'listing') {
    const listing = ListingIdentitySchema.safeParse(JSON.parse(value))
    if (!listing.success) {
      addMonitorDraftIssue(issues, 'listing', 'Listing is invalid.')
      return
    }
    draftPatch.listing = listing.data
  }
}

const resolveProviderInterval = ({
  allowFallback,
  draftPatch,
  issues,
  providerId,
  interval,
  referenceData,
}: {
  allowFallback: boolean
  draftPatch: Partial<MonitorDraft>
  issues: MonitorDraftIssues
  providerId: string
  interval?: string | null
  referenceData: MonitorReferenceData
}) => {
  if (!interval) return

  const intervals = referenceData.providerIntervalsByProviderId[providerId] ?? []
  if (intervals.includes(interval as any)) return

  if (allowFallback) {
    draftPatch.interval = getProviderIntervalFallback({
      defaultDraftInterval: referenceData.defaultDraftInterval,
      providerId,
      providerIntervalsByProviderId: referenceData.providerIntervalsByProviderId,
    })
    Reflect.deleteProperty(issues, 'interval')
    return
  }

  addMonitorDraftIssue(issues, 'interval', 'Selected interval is not supported for this provider.')
}

const getIssueKey = (field: string) =>
  field === 'provider' ? 'providerId' : field === 'indicator' ? 'indicatorId' : field

export const resolveConfigBoardContextPatch = ({
  decodedContext,
  viewConfig,
  referenceData,
  sourceCard,
}: {
  decodedContext: ConfigBoardContext
  viewConfig: ConfigMonitorViewConfig
  referenceData: MonitorReferenceData
  sourceCard?: ConfigMonitorCard
}): ConfigDropResolution => {
  const draftPatch: Partial<MonitorDraft> = {}
  const issues: MonitorDraftIssues = {}
  const candidates: Array<{ field: string | null; value: string }> = [
    { field: viewConfig.verticalGroupBy, value: decodedContext.verticalGroupValue },
    { field: viewConfig.groupBy, value: decodedContext.groupValue },
    { field: viewConfig.sliceBy, value: decodedContext.sliceValue },
  ]
  const seenFields = new Set<string>()

  candidates.forEach(({ field, value }) => {
    if (!field || value === 'all') return
    if (seenFields.has(field)) {
      addMonitorDraftIssue(
        issues,
        getIssueKey(field),
        'Duplicate board axes are not supported for this drop.'
      )
      return
    }
    seenFields.add(field)

    try {
      applyDimension({ draftPatch, issues, field, value, referenceData })
    } catch {
      addMonitorDraftIssue(issues, getIssueKey(field), 'Board context value is invalid.')
    }
  })

  draftPatch.isActive = decodedContext.statusLane === 'active'

  const providerId = draftPatch.providerId ?? sourceCard?.providerId
  const interval = draftPatch.interval ?? sourceCard?.interval
  if (providerId) {
    resolveProviderInterval({
      allowFallback: Boolean(
        sourceCard &&
          draftPatch.providerId &&
          draftPatch.providerId !== sourceCard.providerId &&
          !seenFields.has('interval')
      ),
      draftPatch,
      issues,
      providerId,
      interval,
      referenceData,
    })
  }

  return {
    draftPatch,
    updatePatch: {
      ...(draftPatch.workflowId ? { workflowId: draftPatch.workflowId } : {}),
      ...(draftPatch.blockId ? { blockId: draftPatch.blockId } : {}),
      ...(draftPatch.providerId ? { providerId: draftPatch.providerId } : {}),
      ...(draftPatch.interval ? { interval: draftPatch.interval } : {}),
      ...(draftPatch.indicatorId ? { indicatorId: draftPatch.indicatorId } : {}),
      ...(draftPatch.listing ? { listing: draftPatch.listing } : {}),
      ...(typeof draftPatch.isActive === 'boolean' ? { isActive: draftPatch.isActive } : {}),
      ...(draftPatch.indicatorInputs ? { indicatorInputs: draftPatch.indicatorInputs } : {}),
    },
    issues,
  }
}
