import { describe, expect, it } from 'vitest'
import type { IndicatorMonitorRecord, MonitorReferenceData } from '../shared/types'
import { DEFAULT_CONFIG_MONITOR_VIEW_CONFIG } from '../view/view-config'
import { buildConfigBoardSections } from './config-board-state'
import { buildConfigMonitorCards } from './config-card-model'
import {
  buildDraftFromMonitorWithPatch,
  buildMonitorUpdatePayloadFromDraft,
  validateMonitorDraft,
} from './config-draft'
import { resolveConfigBoardContextPatch } from './config-drop'
import { filterConfigMonitorCards } from './config-filter'
import { parseConfigQuery, serializeConfigFilters } from './config-query'
import { buildConfigSearchSuggestionSet } from './config-search'

const referenceData: MonitorReferenceData = {
  workflowTargets: [
    {
      workflowId: 'workflow-1',
      blockId: 'block-1',
      workflowName: 'Workflow One',
      workflowColor: '#3972F6',
      isDeployed: true,
      blockName: 'Indicator Trigger',
      label: 'Workflow One - Indicator Trigger',
    },
  ],
  workflowTargetByKey: {
    'workflow-1:block-1': {
      workflowId: 'workflow-1',
      blockId: 'block-1',
      workflowName: 'Workflow One',
      workflowColor: '#3972F6',
      isDeployed: true,
      blockName: 'Indicator Trigger',
      label: 'Workflow One - Indicator Trigger',
    },
  },
  workflowOptions: [],
  indicatorOptions: [{ id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' }],
  indicatorById: {
    rsi: { id: 'rsi', name: 'RSI', source: 'default', color: '#3972F6' },
  },
  streamingProviders: [{ id: 'alpaca', name: 'Alpaca' }],
  providerById: { alpaca: { id: 'alpaca', name: 'Alpaca' } },
  providerIntervalsByProviderId: { alpaca: ['1m'] },
  providerParamDefinitionsByProviderId: {},
  defaultDraftProviderId: 'alpaca',
  defaultDraftInterval: '1m',
  createDisabledReason: null,
  isLoading: false,
  warning: null,
}

const monitor = {
  monitorId: 'monitor-1',
  workflowId: 'workflow-1',
  blockId: 'block-1',
  isActive: true,
  providerConfig: {
    triggerId: 'indicator_trigger',
    version: 1,
    monitor: {
      providerId: 'alpaca',
      interval: '1m',
      listing: { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
      indicatorId: 'rsi',
      indicatorInputs: { Length: 14 },
    },
  },
  createdAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-24T00:00:00.000Z',
} satisfies IndicatorMonitorRecord

describe('config monitor domain', () => {
  it('derives cards with reference labels and nullable summaries', () => {
    const [card] = buildConfigMonitorCards([monitor], referenceData, {})

    expect(card).toMatchObject({
      monitorId: 'monitor-1',
      workflowTargetKey: 'workflow-1:block-1',
      workflowTargetLabel: 'Workflow One - Indicator Trigger',
      indicatorName: 'RSI',
      providerLabel: 'Alpaca',
      listingLabel: 'AAPL',
      lastExecutionAt: null,
      lastOutcome: null,
      lastExecutionLogId: null,
    })
  })

  it('round-trips config query values with quoted workflow targets and listing JSON', () => {
    const card = buildConfigMonitorCards([monitor], referenceData, {})[0]!
    const serialized = serializeConfigFilters([
      { field: 'workflowTarget', operator: '=', values: ['workflow-1:block-1'] },
      { field: 'listing', operator: '=', values: [card.listingValue] },
    ])
    const parsed = parseConfigQuery(serialized)

    expect(serialized).toContain('workflowTarget:"workflow-1:block-1"')
    expect(parsed.invalidTokens).toEqual([])
    expect(parsed.filters).toHaveLength(2)
  })

  it('rejects unsupported config query operator tokens', () => {
    const parsed = parseConfigQuery('provider:!=alpaca -provider:alpaca')

    expect(parsed.invalidTokens).toEqual(['provider:!=alpaca'])
    expect(parsed.filters).toContainEqual({
      field: 'provider',
      operator: '!=',
      values: ['alpaca'],
    })
  })

  it('includes execution summary presence suggestions', () => {
    const suggestions = buildConfigSearchSuggestionSet(
      buildConfigMonitorCards([monitor], referenceData, {}),
      referenceData
    )
    const serialized = suggestions.map((suggestion) => serializeConfigFilters([suggestion.filter]))

    expect(serialized).toEqual(
      expect.arrayContaining([
        'has:lastExecutionAt',
        'no:lastExecutionAt',
        'has:lastOutcome',
        'no:lastOutcome',
        'has:lastExecutionLogId',
        'no:lastExecutionLogId',
      ])
    )
  })

  it('filters and builds section/group/status lane board state', () => {
    const cards = buildConfigMonitorCards([monitor], referenceData, {})
    const filtered = filterConfigMonitorCards(cards, {
      ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      quickFilters: [{ field: 'status', operator: '=', values: ['active'] }],
    })
    const sections = buildConfigBoardSections(
      filtered,
      {
        ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        sliceBy: null,
        groupBy: 'workflowTarget',
        verticalGroupBy: 'provider',
      },
      referenceData
    )

    expect(filtered).toHaveLength(1)
    expect(sections[0]?.label).toBe('All monitors')
    expect(sections[0]?.groups[0]?.statusLanes[0]?.buckets[0]?.cards[0]?.monitorId).toBe(
      'monitor-1'
    )
    expect(sections[0]?.groups[0]?.statusLanes[0]?.aggregates).toMatchObject({
      count: 1,
      activeCount: 1,
      pausedCount: 0,
    })
  })

  it('returns empty config kanban lanes instead of an empty board when no axis values exist', () => {
    const sections = buildConfigBoardSections([], DEFAULT_CONFIG_MONITOR_VIEW_CONFIG, {
      ...referenceData,
      workflowTargets: [],
      workflowTargetByKey: {},
    })

    expect(sections).toHaveLength(1)
    expect(sections[0]?.label).toBe('All monitors')
    expect(sections[0]?.groups).toHaveLength(1)
    expect(sections[0]?.groups[0]?.label).toBe('Workflow target')
    expect(sections[0]?.groups[0]?.cards).toEqual([])
    expect(sections[0]?.groups[0]?.statusLanes.map((lane) => lane.label)).toEqual([
      'Active',
      'Paused',
    ])
    expect(
      sections[0]?.groups[0]?.statusLanes.every(
        (lane) => lane.cards.length === 0 && lane.buckets.length === 1
      )
    ).toBe(true)
    expect(
      sections[0]?.groups[0]?.statusLanes.every((lane) => lane.buckets[0]?.cards.length === 0)
    ).toBe(true)
  })

  it('applies the active lane status when creating a draft from board context', () => {
    const resolution = resolveConfigBoardContextPatch({
      decodedContext: {
        version: 1,
        sliceValue: 'all',
        groupValue: 'all',
        verticalGroupValue: 'all',
        statusLane: 'active',
      },
      viewConfig: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
      referenceData,
    })

    expect(resolution.draftPatch).toMatchObject({
      isActive: true,
    })
    expect(resolution.updatePatch).toMatchObject({
      isActive: true,
    })
  })

  it('falls back to a supported interval when a provider drop changes capabilities', () => {
    const card = buildConfigMonitorCards([monitor], referenceData, {})[0]!
    const resolution = resolveConfigBoardContextPatch({
      decodedContext: {
        version: 1,
        sliceValue: 'all',
        groupValue: 'tradier',
        verticalGroupValue: 'all',
        statusLane: 'active',
      },
      viewConfig: {
        ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        groupBy: 'provider',
      },
      referenceData: {
        ...referenceData,
        streamingProviders: [
          ...referenceData.streamingProviders,
          { id: 'tradier', name: 'Tradier' },
        ],
        providerById: {
          ...referenceData.providerById,
          tradier: { id: 'tradier', name: 'Tradier' },
        },
        providerIntervalsByProviderId: {
          ...referenceData.providerIntervalsByProviderId,
          tradier: ['5m'],
        },
      },
      sourceCard: card,
    })

    expect(resolution.errors).not.toHaveProperty('interval')
    expect(resolution.draftPatch).toMatchObject({
      providerId: 'tradier',
      interval: '5m',
    })
    expect(resolution.updatePatch).toMatchObject({
      providerId: 'tradier',
      interval: '5m',
    })
  })

  it('falls back to the default draft interval when a provider drop has no interval list', () => {
    const card = buildConfigMonitorCards([monitor], referenceData, {})[0]!
    const nextReferenceData: MonitorReferenceData = {
      ...referenceData,
      streamingProviders: [...referenceData.streamingProviders, { id: 'tradier', name: 'Tradier' }],
      providerById: {
        ...referenceData.providerById,
        tradier: { id: 'tradier', name: 'Tradier' },
      },
      providerIntervalsByProviderId: {
        ...referenceData.providerIntervalsByProviderId,
        tradier: [],
      },
      defaultDraftInterval: '15m',
    }
    const resolution = resolveConfigBoardContextPatch({
      decodedContext: {
        version: 1,
        sliceValue: 'all',
        groupValue: 'tradier',
        verticalGroupValue: 'all',
        statusLane: 'active',
      },
      viewConfig: {
        ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        groupBy: 'provider',
      },
      referenceData: nextReferenceData,
      sourceCard: card,
    })

    expect(resolution.errors).not.toHaveProperty('interval')
    expect(resolution.draftPatch).toMatchObject({
      providerId: 'tradier',
      interval: '15m',
    })
    expect(resolution.updatePatch).toMatchObject({
      providerId: 'tradier',
      interval: '15m',
    })
  })

  it('rejects explicit invalid interval drops instead of rewriting them', () => {
    const card = buildConfigMonitorCards([monitor], referenceData, {})[0]!
    const resolution = resolveConfigBoardContextPatch({
      decodedContext: {
        version: 1,
        sliceValue: 'all',
        groupValue: 'tradier',
        verticalGroupValue: '1m',
        statusLane: 'active',
      },
      viewConfig: {
        ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        groupBy: 'provider',
        verticalGroupBy: 'interval',
      },
      referenceData: {
        ...referenceData,
        streamingProviders: [
          ...referenceData.streamingProviders,
          { id: 'tradier', name: 'Tradier' },
        ],
        providerById: {
          ...referenceData.providerById,
          tradier: { id: 'tradier', name: 'Tradier' },
        },
        providerIntervalsByProviderId: {
          ...referenceData.providerIntervalsByProviderId,
          tradier: ['5m'],
        },
      },
      sourceCard: card,
    })

    expect(resolution.errors).toMatchObject({
      interval: 'Selected interval is not supported for this provider.',
    })
    expect(resolution.draftPatch).toMatchObject({
      providerId: 'tradier',
      interval: '1m',
    })
  })

  it('clears provider-bound draft state when a monitor edit changes provider', () => {
    const sourceMonitor: IndicatorMonitorRecord = {
      ...monitor,
      providerConfig: {
        ...monitor.providerConfig,
        monitor: {
          ...monitor.providerConfig.monitor,
          auth: {
            encryptedSecretFieldIds: ['apiKey'],
            secretReferences: { apiKey: 'OLD_API_KEY' },
          },
          providerParams: { feed: 'iex' },
        },
      },
    }
    const nextReferenceData: MonitorReferenceData = {
      ...referenceData,
      streamingProviders: [...referenceData.streamingProviders, { id: 'tradier', name: 'Tradier' }],
      providerById: {
        ...referenceData.providerById,
        tradier: { id: 'tradier', name: 'Tradier' },
      },
      providerIntervalsByProviderId: {
        ...referenceData.providerIntervalsByProviderId,
        tradier: ['5m'],
      },
      providerParamDefinitionsByProviderId: {
        tradier: [
          { id: 'token', type: 'string', title: 'Token', required: true, password: true },
          { id: 'feed', type: 'string', title: 'Feed', required: true },
        ],
      },
    }

    const draft = buildDraftFromMonitorWithPatch(
      sourceMonitor,
      { providerId: 'tradier' },
      nextReferenceData
    )
    const validation = validateMonitorDraft({ draft, referenceData: nextReferenceData })

    expect(draft).toMatchObject({
      providerId: 'tradier',
      interval: '5m',
      listing: null,
      secretValues: {},
      providerParamValues: {},
      existingEncryptedSecretFieldIds: [],
    })
    expect(validation.errors).toMatchObject({
      listing: 'Listing is required.',
      'secret:token': 'Token is required.',
      'param:feed': 'Feed is required.',
    })
  })

  it('uses the default draft interval when an editor provider change has no interval list', () => {
    const nextReferenceData: MonitorReferenceData = {
      ...referenceData,
      streamingProviders: [...referenceData.streamingProviders, { id: 'tradier', name: 'Tradier' }],
      providerById: {
        ...referenceData.providerById,
        tradier: { id: 'tradier', name: 'Tradier' },
      },
      providerIntervalsByProviderId: {
        ...referenceData.providerIntervalsByProviderId,
        tradier: [],
      },
      defaultDraftInterval: '15m',
    }
    const draft = buildDraftFromMonitorWithPatch(
      monitor,
      { providerId: 'tradier' },
      nextReferenceData
    )
    const validation = validateMonitorDraft({ draft, referenceData: nextReferenceData })

    expect(draft).toMatchObject({
      providerId: 'tradier',
      interval: '15m',
    })
    expect(validation.errors).not.toHaveProperty('interval')
  })

  it('builds provider-change updates only from the new provider draft state', () => {
    const sourceMonitor: IndicatorMonitorRecord = {
      ...monitor,
      providerConfig: {
        ...monitor.providerConfig,
        monitor: {
          ...monitor.providerConfig.monitor,
          auth: {
            encryptedSecretFieldIds: ['apiKey'],
            secretReferences: { apiKey: 'OLD_API_KEY' },
          },
          providerParams: { feed: 'iex' },
        },
      },
    }
    const nextReferenceData: MonitorReferenceData = {
      ...referenceData,
      streamingProviders: [...referenceData.streamingProviders, { id: 'tradier', name: 'Tradier' }],
      providerById: {
        ...referenceData.providerById,
        tradier: { id: 'tradier', name: 'Tradier' },
      },
      providerIntervalsByProviderId: {
        ...referenceData.providerIntervalsByProviderId,
        tradier: ['5m'],
      },
    }
    const draft = buildDraftFromMonitorWithPatch(
      sourceMonitor,
      {
        providerId: 'tradier',
        listing: monitor.providerConfig.monitor.listing,
      },
      nextReferenceData
    )

    const payload = buildMonitorUpdatePayloadFromDraft({
      workspaceId: 'workspace-1',
      draft,
      originalMonitor: sourceMonitor,
      referenceData: nextReferenceData,
    })

    expect(payload).toMatchObject({
      workspaceId: 'workspace-1',
      providerId: 'tradier',
      interval: '5m',
    })
    expect(payload).not.toHaveProperty('auth')
    expect(payload).not.toHaveProperty('providerParams')
  })

  it('clears stale indicator inputs when an indicator board drop changes indicators', () => {
    const card = buildConfigMonitorCards([monitor], referenceData, {})[0]!
    const nextReferenceData: MonitorReferenceData = {
      ...referenceData,
      indicatorOptions: [
        ...referenceData.indicatorOptions,
        {
          id: 'sma',
          name: 'SMA',
          source: 'default',
          color: '#D97706',
          inputMeta: { Length: { title: 'Length', type: 'int', defval: 20 } },
        },
      ],
      indicatorById: {
        ...referenceData.indicatorById,
        rsi: {
          id: 'rsi',
          name: 'RSI',
          source: 'default',
          color: '#3972F6',
          inputMeta: { Length: { title: 'Length', type: 'int', defval: 14 } },
        },
        sma: {
          id: 'sma',
          name: 'SMA',
          source: 'default',
          color: '#D97706',
          inputMeta: { Length: { title: 'Length', type: 'int', defval: 20 } },
        },
      },
    }
    const resolution = resolveConfigBoardContextPatch({
      decodedContext: {
        version: 1,
        sliceValue: 'all',
        groupValue: 'sma',
        verticalGroupValue: 'all',
        statusLane: 'active',
      },
      viewConfig: {
        ...DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
        groupBy: 'indicator',
      },
      referenceData: nextReferenceData,
      sourceCard: card,
    })

    const draft = buildDraftFromMonitorWithPatch(
      card.sourceMonitor,
      resolution.draftPatch,
      nextReferenceData
    )

    expect(resolution.draftPatch).toMatchObject({
      indicatorId: 'sma',
      indicatorInputs: {},
    })
    expect(draft.indicatorInputs).toEqual({})
  })
})
