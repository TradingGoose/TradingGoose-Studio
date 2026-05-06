import type { ListingIdentity } from '@/lib/listing/identity'
import type {
  IndicatorMonitorCreateInput,
  IndicatorMonitorRecord,
  IndicatorMonitorUpdateInput,
  MonitorDraft,
  MonitorReferenceData,
} from '../shared/types'
import { buildDefaultDraft, buildDraftFromMonitor, isAuthParamDefinition } from '../shared/utils'

export type MonitorDraftValidationResult = {
  valid: boolean
  errors: Record<string, string>
}

const areJsonEqual = (left: unknown, right: unknown) => {
  try {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
  } catch {
    return false
  }
}

const trimRecordValues = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0)
  )

const mapProviderParamsToComparableValues = (
  providerParams: Record<string, unknown> | undefined
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(providerParams ?? {})
      .map(([key, value]) => {
        if (typeof value === 'string') return [key, value.trim()] as const
        if (typeof value === 'number' || typeof value === 'boolean') {
          return [key, String(value)] as const
        }
        return [key, JSON.stringify(value)] as const
      })
      .filter(([, value]) => value.length > 0)
  )

const getProviderDefinitions = (referenceData: MonitorReferenceData, providerId: string) =>
  referenceData.providerParamDefinitionsByProviderId[providerId] ?? []

export const getProviderIntervalFallback = ({
  defaultDraftInterval,
  providerId,
  providerIntervalsByProviderId,
}: {
  defaultDraftInterval: string
  providerId: string
  providerIntervalsByProviderId: Record<string, string[]>
}) => providerIntervalsByProviderId[providerId]?.[0] ?? defaultDraftInterval ?? '1m'

const pruneIndicatorInputs = (
  inputMeta: MonitorReferenceData['indicatorById'][string]['inputMeta'],
  inputs: Record<string, unknown>
) => {
  if (!inputMeta) return {}
  return Object.fromEntries(
    Object.entries(inputs).filter(([title]) => Object.hasOwn(inputMeta, title))
  )
}

export const mergeMonitorDraftPatch = ({
  draft,
  patch,
  referenceData,
}: {
  draft: MonitorDraft
  patch: Partial<MonitorDraft>
  referenceData: MonitorReferenceData
}): MonitorDraft => {
  const nextProviderId = patch.providerId ?? draft.providerId
  const providerChanged = nextProviderId !== draft.providerId
  const nextIndicatorId = patch.indicatorId ?? draft.indicatorId
  const indicatorChanged = nextIndicatorId !== draft.indicatorId
  const nextInputMeta = referenceData.indicatorById[nextIndicatorId]?.inputMeta
  const nextIntervals = referenceData.providerIntervalsByProviderId[nextProviderId] ?? []
  const requestedInterval = patch.interval ?? draft.interval
  const nextInterval =
    providerChanged && !nextIntervals.includes(requestedInterval as any)
      ? getProviderIntervalFallback({
          defaultDraftInterval: referenceData.defaultDraftInterval,
          providerId: nextProviderId,
          providerIntervalsByProviderId: referenceData.providerIntervalsByProviderId,
        })
      : requestedInterval

  return {
    ...draft,
    ...patch,
    providerId: nextProviderId,
    interval: nextInterval,
    listing: providerChanged
      ? Object.hasOwn(patch, 'listing')
        ? (patch.listing ?? null)
        : null
      : Object.hasOwn(patch, 'listing')
        ? (patch.listing ?? null)
        : draft.listing,
    secretValues: providerChanged
      ? (patch.secretValues ?? {})
      : (patch.secretValues ?? draft.secretValues),
    providerParamValues: providerChanged
      ? (patch.providerParamValues ?? {})
      : (patch.providerParamValues ?? draft.providerParamValues),
    existingEncryptedSecretFieldIds: providerChanged
      ? (patch.existingEncryptedSecretFieldIds ?? [])
      : (patch.existingEncryptedSecretFieldIds ?? draft.existingEncryptedSecretFieldIds),
    indicatorInputs: Object.hasOwn(patch, 'indicatorInputs')
      ? (patch.indicatorInputs ?? {})
      : indicatorChanged
        ? pruneIndicatorInputs(nextInputMeta, draft.indicatorInputs)
        : (patch.indicatorInputs ?? draft.indicatorInputs),
  }
}

export const buildBlankMonitorDraft = (referenceData: MonitorReferenceData) =>
  buildDefaultDraft({
    providerId: referenceData.defaultDraftProviderId,
    interval: referenceData.defaultDraftInterval,
  })

export const validateMonitorDraft = ({
  draft,
  referenceData,
}: {
  draft: MonitorDraft | null
  referenceData: MonitorReferenceData
}): MonitorDraftValidationResult => {
  if (!draft) return { valid: false, errors: { draft: 'Missing draft state.' } }

  const errors: Record<string, string> = {}
  const replacesAuth = Object.keys(draft.secretValues).length > 0
  if (!draft.workflowId) errors.workflowId = 'Workflow is required.'
  if (!draft.blockId) errors.blockId = 'Block target is required.'
  if (!draft.providerId) errors.providerId = 'Provider is required.'
  if (!draft.interval) errors.interval = 'Interval is required.'
  if (!draft.indicatorId) errors.indicatorId = 'Indicator is required.'
  if (!draft.listing) errors.listing = 'Listing is required.'

  const workflowTargetKey = `${draft.workflowId}:${draft.blockId}`
  if (draft.workflowId && draft.blockId && !referenceData.workflowTargetByKey[workflowTargetKey]) {
    errors.workflowId = 'Selected workflow target is not deployed with an indicator trigger.'
  }

  if (draft.indicatorId && !referenceData.indicatorById[draft.indicatorId]) {
    errors.indicatorId = 'Selected indicator is unavailable.'
  }

  if (draft.providerId && !referenceData.providerById[draft.providerId]) {
    errors.providerId = 'Selected provider is unavailable.'
  }

  const availableIntervals = referenceData.providerIntervalsByProviderId[draft.providerId] ?? []
  if (
    draft.interval &&
    availableIntervals.length > 0 &&
    !availableIntervals.includes(draft.interval as any)
  ) {
    errors.interval = 'Selected interval is not supported for this provider.'
  }

  getProviderDefinitions(referenceData, draft.providerId)
    .filter((definition) => definition.required)
    .forEach((definition) => {
      if (definition.visibility === 'hidden' || definition.visibility === 'llm-only') return

      if (isAuthParamDefinition(definition)) {
        if (!draft.isActive) return
        const entered = (draft.secretValues[definition.id] || '').trim()
        const hasExisting =
          !replacesAuth && draft.existingEncryptedSecretFieldIds.includes(definition.id)
        if (!entered && !hasExisting) {
          errors[`secret:${definition.id}`] = `${definition.title || definition.id} is required.`
        }
        return
      }

      const value = (draft.providerParamValues[definition.id] || '').trim()
      if (!value) {
        errors[`param:${definition.id}`] = `${definition.title || definition.id} is required.`
      }
    })

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  }
}

export const buildMonitorCreatePayloadFromDraft = ({
  workspaceId,
  draft,
}: {
  workspaceId: string
  draft: MonitorDraft
  referenceData: MonitorReferenceData
}): IndicatorMonitorCreateInput => {
  const providerParams = trimRecordValues(draft.providerParamValues)

  return {
    workspaceId,
    workflowId: draft.workflowId,
    blockId: draft.blockId,
    providerId: draft.providerId,
    interval: draft.interval,
    indicatorId: draft.indicatorId,
    listing: draft.listing as ListingIdentity,
    auth: {
      secrets: trimRecordValues(draft.secretValues),
    },
    ...(Object.keys(providerParams).length > 0 ? { providerParams } : {}),
    ...(Object.keys(draft.indicatorInputs).length > 0
      ? { indicatorInputs: draft.indicatorInputs }
      : {}),
    isActive: draft.isActive,
  }
}

export const buildMonitorUpdatePayloadFromDraft = ({
  workspaceId,
  draft,
  originalMonitor,
}: {
  workspaceId: string
  draft: MonitorDraft
  originalMonitor: IndicatorMonitorRecord
  referenceData: MonitorReferenceData
}): IndicatorMonitorUpdateInput => {
  const originalConfig = originalMonitor.providerConfig.monitor
  const providerChanged = draft.providerId !== originalConfig.providerId
  const indicatorChanged = draft.indicatorId !== originalConfig.indicatorId
  const nextProviderParams = trimRecordValues(draft.providerParamValues)
  const previousProviderParams = mapProviderParamsToComparableValues(originalConfig.providerParams)
  const nextSecrets = trimRecordValues(draft.secretValues)
  const secretsTouched = Object.keys(draft.secretValues).length > 0
  const indicatorInputsChanged = !areJsonEqual(
    draft.indicatorInputs,
    originalConfig.indicatorInputs ?? {}
  )

  return {
    workspaceId,
    workflowId: draft.workflowId,
    blockId: draft.blockId,
    providerId: draft.providerId,
    interval: draft.interval,
    indicatorId: draft.indicatorId,
    listing: draft.listing as ListingIdentity,
    ...(secretsTouched ? { auth: { secrets: nextSecrets } } : {}),
    ...((providerChanged && Object.keys(nextProviderParams).length > 0) ||
    (!providerChanged && !areJsonEqual(nextProviderParams, previousProviderParams))
      ? { providerParams: nextProviderParams }
      : {}),
    ...(indicatorChanged || indicatorInputsChanged
      ? { indicatorInputs: draft.indicatorInputs }
      : {}),
    isActive: draft.isActive,
  }
}

export const buildOptimisticMonitorRecordFromDraft = (
  monitor: IndicatorMonitorRecord,
  draft: MonitorDraft
): IndicatorMonitorRecord => ({
  ...monitor,
  workflowId: draft.workflowId,
  blockId: draft.blockId,
  isActive: draft.isActive,
  updatedAt: new Date().toISOString(),
  providerConfig: {
    ...monitor.providerConfig,
    monitor: {
      ...monitor.providerConfig.monitor,
      providerId: draft.providerId,
      interval: draft.interval,
      indicatorId: draft.indicatorId,
      listing: draft.listing as ListingIdentity,
      providerParams: trimRecordValues(draft.providerParamValues),
      indicatorInputs: draft.indicatorInputs,
    },
  },
})

export const buildDraftFromMonitorWithPatch = (
  monitor: IndicatorMonitorRecord,
  patch: Partial<MonitorDraft>,
  referenceData: MonitorReferenceData
) =>
  mergeMonitorDraftPatch({
    draft: buildDraftFromMonitor(monitor),
    patch,
    referenceData,
  })
