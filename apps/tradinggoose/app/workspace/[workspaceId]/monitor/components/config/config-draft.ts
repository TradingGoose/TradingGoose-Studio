import type { ListingIdentity } from '@/lib/listing/identity'
import type {
  MonitorCreateInput,
  MonitorDraft,
  MonitorRecord,
  MonitorReferenceData,
  MonitorUpdateInput,
  PortfolioMonitorCreateInput,
  PortfolioMonitorUpdateInput,
} from '../shared/types'
import { buildDefaultDraft, buildDraftFromMonitor, isAuthParamDefinition } from '../shared/utils'

type MonitorDraftValidationResult = {
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

const getDefaultProviderIdForSource = (
  source: MonitorDraft['source'],
  referenceData: MonitorReferenceData
) =>
  source === 'portfolio'
    ? referenceData.defaultPortfolioProviderId
    : referenceData.defaultMarketProviderId

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
  const nextSource = patch.source ?? draft.source
  if (nextSource !== draft.source) {
    return {
      ...buildDefaultDraft({
        source: nextSource,
        providerId: getDefaultProviderIdForSource(nextSource, referenceData),
        interval: referenceData.defaultDraftInterval,
      }),
      isActive: draft.isActive,
      ...patch,
      source: nextSource,
    }
  }

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
    source: nextSource,
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
    serviceId: providerChanged ? (patch.serviceId ?? '') : (patch.serviceId ?? draft.serviceId),
    credentialId: providerChanged
      ? (patch.credentialId ?? '')
      : (patch.credentialId ?? draft.credentialId),
    accountId: providerChanged ? (patch.accountId ?? '') : (patch.accountId ?? draft.accountId),
    indicatorInputs: Object.hasOwn(patch, 'indicatorInputs')
      ? (patch.indicatorInputs ?? {})
      : indicatorChanged
        ? pruneIndicatorInputs(nextInputMeta, draft.indicatorInputs)
        : (patch.indicatorInputs ?? draft.indicatorInputs),
  }
}

export const buildBlankMonitorDraft = (
  referenceData: MonitorReferenceData,
  source: MonitorDraft['source'] = 'indicator'
) =>
  buildDefaultDraft({
    source,
    providerId: getDefaultProviderIdForSource(source, referenceData),
    interval: referenceData.defaultDraftInterval,
  })

const hasPortfolioConditionRules = (draft: MonitorDraft) =>
  Array.isArray(draft.condition?.root?.rules) && draft.condition.root.rules.length > 0

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

  const workflowTargetKey = `${draft.workflowId}:${draft.blockId}`
  const workflowTarget = referenceData.workflowTargetByKey[workflowTargetKey]
  if (
    draft.workflowId &&
    draft.blockId &&
    (!workflowTarget || workflowTarget.source !== draft.source)
  ) {
    errors.workflowId =
      draft.source === 'portfolio'
        ? 'Selected workflow target is not deployed with a portfolio state trigger.'
        : 'Selected workflow target is not deployed with an indicator trigger.'
  }

  if (draft.source === 'portfolio') {
    if (draft.providerId && !referenceData.tradingProviderById[draft.providerId]) {
      errors.providerId = 'Selected trading provider is unavailable.'
    }
    if (!draft.serviceId) errors.serviceId = 'Trading connection is required.'
    if (!draft.credentialId || !draft.accountId) errors.accountId = 'Trading account is required.'
    if (!hasPortfolioConditionRules(draft)) {
      errors.condition = 'At least one fire condition is required.'
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
    }
  }

  if (!draft.interval) errors.interval = 'Interval is required.'
  if (!draft.indicatorId) errors.indicatorId = 'Indicator is required.'
  if (!draft.listing) errors.listing = 'Listing is required.'
  if (draft.indicatorId && !referenceData.indicatorById[draft.indicatorId]) {
    errors.indicatorId = 'Selected indicator is unavailable.'
  }
  if (draft.providerId && !referenceData.marketProviderById[draft.providerId]) {
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
}): MonitorCreateInput => {
  if (draft.source === 'portfolio') {
    return {
      source: 'portfolio',
      workspaceId,
      workflowId: draft.workflowId,
      blockId: draft.blockId,
      providerId: draft.providerId,
      serviceId: draft.serviceId,
      credentialId: draft.credentialId,
      accountId: draft.accountId,
      condition: draft.condition,
      fireMode: draft.fireMode,
      cooldownSeconds: draft.cooldownSeconds,
      pollIntervalSeconds: draft.pollIntervalSeconds,
      isActive: draft.isActive,
    } satisfies PortfolioMonitorCreateInput
  }

  const providerParams = trimRecordValues(draft.providerParamValues)

  return {
    source: 'indicator',
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
  originalMonitor: MonitorRecord
  referenceData: MonitorReferenceData
}): MonitorUpdateInput => {
  const originalConfig = originalMonitor.providerConfig.monitor
  if (originalMonitor.source === 'portfolio') {
    return {
      source: 'portfolio',
      workspaceId,
      workflowId: draft.workflowId,
      blockId: draft.blockId,
      providerId: draft.providerId,
      serviceId: draft.serviceId,
      credentialId: draft.credentialId,
      accountId: draft.accountId,
      condition: draft.condition,
      fireMode: draft.fireMode,
      cooldownSeconds: draft.cooldownSeconds,
      pollIntervalSeconds: draft.pollIntervalSeconds,
      isActive: draft.isActive,
    } satisfies PortfolioMonitorUpdateInput
  }

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
    source: 'indicator',
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
  monitor: MonitorRecord,
  draft: MonitorDraft
): MonitorRecord => ({
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
      ...(draft.source === 'portfolio'
        ? {
            serviceId: draft.serviceId,
            credentialId: draft.credentialId,
            accountId: draft.accountId,
            condition: draft.condition,
            fireMode: draft.fireMode,
            cooldownSeconds: draft.cooldownSeconds,
            pollIntervalSeconds: draft.pollIntervalSeconds,
          }
        : {
            interval: draft.interval,
            indicatorId: draft.indicatorId,
            listing: draft.listing as ListingIdentity,
            providerParams: trimRecordValues(draft.providerParamValues),
            indicatorInputs: draft.indicatorInputs,
          }),
    },
  },
})

export const buildDraftFromMonitorWithPatch = (
  monitor: MonitorRecord,
  patch: Partial<MonitorDraft>,
  referenceData: MonitorReferenceData
) =>
  mergeMonitorDraftPatch({
    draft: buildDraftFromMonitor(monitor),
    patch,
    referenceData,
  })
