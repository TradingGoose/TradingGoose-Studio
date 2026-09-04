import { execFileSync } from 'child_process'
import path from 'path'
import { beforeAll, describe, expect, it } from 'bun:test'

const rootDir = path.resolve(import.meta.dir, '../..')

interface MetadataSnapshot {
  toolTypes: string[]
  builtInTypes: string[]
  tradingSubBlocks: string[]
  tradingParams: string[]
  formsParams: string[]
  airtableList?: string
  vaultCreateMatters?: string
  vaultParamsWithoutDescriptions: string[]
  datadogSeriesPlaceholder?: string
  visionModelOptions: Array<{ id: string; label: string }>
  visionModelDefault?: string
  translateModelOptions: Array<{ id: string; label: string }>
  translateModelHasOptions: boolean
  translateModelHasDefault: boolean
  translateApiKeyRequired?: boolean
  invalidOperationMappings: string[]
  translateToolIds: string[]
  translateParams: string[]
  translateOutputs: string[]
  historyOutputs: string[]
  detailOutputs: string[]
  triggerIds: string[]
  scheduleDelivery?: string
  scheduleTypeDefault?: string
  scheduleTimezoneDefault?: string
  portfolioDelivery?: string
  portfolioInstructions: string[]
  portfolioMonitorOutputs: string[]
}

let metadata: MetadataSnapshot

beforeAll(() => {
  const script = `
    globalThis.fetch = () => { throw new Error('Documentation metadata attempted a network request') }
    const {
      getBlockDocConfigs,
      getToolDocConfigs,
      getTriggerDocConfigs,
      loadToolDocSources,
    } = await import('./scripts/doc-gen/runtime-metadata')
    const sources = await loadToolDocSources(process.cwd())
    const byType = new Map(sources.map((source) => [source.config.type, source]))
    const triggers = getTriggerDocConfigs()
    const byTriggerId = new Map(triggers.map((trigger) => [trigger.id, trigger]))
    const invalidOperationMappings = []
    for (const source of sources) {
      const operationField = source.config.subBlocks.find(
        (subBlock) => subBlock.id === source.config.operationFieldId
      )
      if (
        operationField &&
        Object.keys(source.config.operationToolMap ?? {}).length !== operationField.options.length
      ) {
        invalidOperationMappings.push(source.config.type + ': incomplete operation map')
      }
      for (const toolId of Object.values(source.config.operationToolMap ?? {})) {
        if (!source.config.tools?.access?.includes(toolId)) {
          invalidOperationMappings.push(source.config.type + ': ' + toolId)
        }
      }
    }
    const trading = byType.get('trading_action')
    const forms = byType.get('google_forms')
    const vault = byType.get('google_vault')
    const datadog = byType.get('datadog')
    const vision = byType.get('vision')
    const translate = byType.get('translate')
    const history = byType.get('trading_order_history')
    const detail = byType.get('trading_order_detail')
    const portfolio = byTriggerId.get('portfolio_state_trigger')
    console.log(JSON.stringify({
      toolTypes: getToolDocConfigs().map((config) => config.type),
      builtInTypes: getBlockDocConfigs().map((config) => config.type),
      tradingSubBlocks: trading.config.subBlocks.map((field) => field.id),
      tradingParams: trading.toolInfo.get('trading_place_order').params.map((param) => param.name),
      formsParams: forms.toolInfo.get('google_forms_get_responses').params.map((param) => param.name),
      airtableList: byType.get('airtable').config.operationToolMap?.list,
      vaultCreateMatters: vault.config.operationToolMap?.create_matters,
      vaultParamsWithoutDescriptions: [...vault.toolInfo].flatMap(([toolId, info]) =>
        info.params
          .filter((param) => param.description === 'No description')
          .map((param) => toolId + ': ' + param.name)
      ),
      datadogSeriesPlaceholder: datadog.config.subBlocks.find(
        (field) => field.id === 'series'
      )?.placeholder,
      visionModelOptions: vision.config.subBlocks.find((field) => field.id === 'model')?.options,
      visionModelDefault: vision.config.subBlocks.find((field) => field.id === 'model')
        ?.defaultValue,
      translateModelOptions:
        translate.config.subBlocks.find((field) => field.id === 'model')?.options ?? [],
      translateModelHasOptions: Object.hasOwn(
        translate.config.subBlocks.find((field) => field.id === 'model'),
        'options'
      ),
      translateModelHasDefault: Object.hasOwn(
        translate.config.subBlocks.find((field) => field.id === 'model'),
        'defaultValue'
      ),
      translateApiKeyRequired: translate.blockInfo.params.find(
        (param) => param.name === 'apiKey'
      )?.required,
      invalidOperationMappings,
      translateToolIds: [...translate.toolInfo.keys()],
      translateParams: translate.blockInfo.params.map((param) => param.name),
      translateOutputs: Object.keys(translate.blockInfo.outputs),
      historyOutputs: Object.keys(history.toolInfo.get('trading_order_history').outputs),
      detailOutputs: Object.keys(detail.toolInfo.get('trading_order_detail').outputs),
      triggerIds: triggers.map((trigger) => trigger.id),
      scheduleDelivery: byTriggerId.get('schedule')?.delivery,
      scheduleTypeDefault: byTriggerId.get('schedule')?.subBlocks.find(
        (field) => field.id === 'scheduleType'
      )?.defaultValue,
      scheduleTimezoneDefault: byTriggerId.get('schedule')?.subBlocks.find(
        (field) => field.id === 'timezone'
      )?.defaultValue,
      portfolioDelivery: portfolio?.delivery,
      portfolioInstructions: portfolio?.instructions ?? [],
      portfolioMonitorOutputs: Object.keys(portfolio?.outputs.monitor ?? {}).filter(
        (key) => key !== 'type' && key !== 'description'
      ),
    }))
  `
  metadata = JSON.parse(
    execFileSync(process.execPath, ['-e', script], { cwd: rootDir, encoding: 'utf8' })
  )
})

describe('runtime documentation metadata', () => {
  it('keeps built-in blocks out of integration tool generation', () => {
    expect(metadata.builtInTypes.length).toBeGreaterThan(0)
    for (const type of metadata.builtInTypes) expect(metadata.toolTypes).not.toContain(type)
    expect(metadata.toolTypes).not.toContain('evaluator')
    expect(metadata.toolTypes).not.toContain('number')
  })

  it('loads canonical provider configs and resolves every static operation mapping', () => {
    expect(metadata.tradingSubBlocks).toContain('listing')
    expect(metadata.tradingParams).toContain('listing')
    expect(metadata.formsParams).toEqual(['formId', 'responseId', 'pageSize'])
    expect(metadata.airtableList).toBe('airtable_list_records')
    expect(metadata.vaultCreateMatters).toBe('google_vault_create_matters')
    expect(metadata.vaultParamsWithoutDescriptions).toEqual([])
    expect(metadata.invalidOperationMappings).toEqual([])
  })

  it('normalizes dynamic preview values without changing the runtime block', () => {
    expect(metadata.datadogSeriesPlaceholder).toContain('"timestamp": 1700000000')
  })

  it('resolves safe runtime choices and defaults without inventing dynamic choices', () => {
    expect(metadata.visionModelOptions).toEqual([
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'claude-3-opus-20240229', label: 'claude-3-opus' },
      { id: 'claude-3-sonnet-20240229', label: 'claude-3-sonnet' },
    ])
    expect(metadata.visionModelDefault).toBe('gpt-4o')
    expect(metadata.translateModelOptions).toEqual([])
    expect(metadata.translateModelHasOptions).toBe(false)
    expect(metadata.translateModelHasDefault).toBe(false)
    expect(metadata.translateApiKeyRequired).toBe(false)
  })

  it('renders dynamic AI dispatch from the block contract instead of fake tools', () => {
    expect(metadata.translateToolIds).toEqual([])
    expect(metadata.translateParams).toContain('model')
    expect(metadata.translateParams).not.toContain('systemPrompt')
    expect(metadata.translateOutputs).toEqual(['content', 'model', 'tokens'])
  })

  it('uses complete runtime schemas for regression-sensitive trading tools', () => {
    expect(metadata.historyOutputs).toEqual([
      'history',
      'count',
      'workspaceId',
      'startDate',
      'endDate',
    ])
    expect(metadata.detailOutputs).toEqual([
      'summary',
      'provider',
      'appOrderId',
      'providerOrderId',
      'workspaceId',
      'logId',
      'orderDetail',
    ])
  })

  it('loads only non-core triggers and distinguishes schedule from polling', () => {
    expect(metadata.triggerIds).not.toContain('api')
    expect(metadata.triggerIds).not.toContain('chat')
    expect(metadata.triggerIds).not.toContain('manual')
    expect(metadata.scheduleDelivery).toBe('schedule')
    expect(metadata.scheduleTypeDefault).toBe('daily')
    expect(metadata.scheduleTimezoneDefault).toBe('UTC')
    expect(metadata.portfolioDelivery).toBe('polling')
    expect(metadata.portfolioInstructions).toHaveLength(4)
    expect(metadata.portfolioMonitorOutputs).toEqual([
      'id',
      'workflowId',
      'blockId',
      'providerId',
      'serviceId',
      'accountId',
    ])
  })
})
