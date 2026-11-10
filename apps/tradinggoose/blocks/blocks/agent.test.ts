import { afterEach, describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { getWorkflowInspectorCopy } from '@/i18n/block-editor'
import {
  getReasoningEffortValues,
  getRegistryModel,
  useModelRegistry,
} from '@/stores/model-registry'
import { buildTriggerEditingLayout } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout'
import { AgentBlock } from './agent'
import { EvaluatorBlock } from './evaluator'
import { GuardrailsBlock } from './guardrails'
import { RouterBlock } from './router'
import { TranslateBlock } from './translate'
import { VisionBlock } from './vision'

const original = useModelRegistry.getState().providers
const providers = [
  {
    id: 'example',
    name: 'Example Models',
    models: [
      {
        id: 'example/effort',
        reasoning: [{ type: 'effort' as const, values: ['minimal', 'extreme'] }],
        temperature: true,
      },
      { id: 'example/plain', reasoning: [], temperature: false },
      { id: 'example/unknown' },
    ],
  },
]
afterEach(() => useModelRegistry.setState({ providers: original }))
const fields = (model: string) =>
  buildTriggerEditingLayout({
    inspectorCopy: getWorkflowInspectorCopy('en'),
    blockType: 'agent',
    blockConfig: AgentBlock,
    blockState: { subBlocks: { model: { value: model } } },
    shouldDisableWrite: false,
  }).additionalRows.flat()

describe('registry-backed model interaction', () => {
  it('uses the same grouped searchable registry selection for every model block', () => {
    useModelRegistry.setState({ providers })
    for (const block of [
      AgentBlock,
      RouterBlock,
      EvaluatorBlock,
      TranslateBlock,
      GuardrailsBlock,
      VisionBlock,
    ]) {
      const field = block.subBlocks.find(({ id }) => id === 'model')!
      expect(field.type).toBe('combobox')
      expect(field.dropdownMode).toBe('sidebar')
      expect(typeof field.options).toBe('function')
      const options = typeof field.options === 'function' ? field.options() : []
      expect(options.map(({ id }) => id)).toEqual(providers[0].models.map(({ id }) => id))
      expect(options[0]).toMatchObject({
        group: 'example',
        searchLabel: 'example/effort Example Models',
      })
      const groups = typeof field.optionGroups === 'function' ? field.optionGroups() : []
      expect(groups).toEqual([{ id: 'example', label: 'Example Models', icon: undefined }])
      expect(block.subBlocks.find(({ id }) => id === 'apiKey')?.password).toBe(true)
    }
  })

  it('retains Additional Fields and unset/Auto without invented reasoning values or ranges', () => {
    useModelRegistry.setState({ providers })
    const available = fields('example/effort')
    for (const id of ['memories', 'responseFormat', 'temperature', 'maxTokens']) {
      const field = available.find((entry) => entry.id === id)!
      expect(field.additional).toBe(true)
      expect(field.defaultValue).toBeUndefined()
      expect(field.value).toBeUndefined()
    }
    expect(available.some(({ id }) => id === 'reasoningEffort')).toBe(false)
    const info = available.find(({ id }) => id === 'reasoningOptions')!
    expect(info.value?.({ model: 'example/effort' })).toContain('minimal, extreme')
    expect(info.value?.({ model: 'example/effort' })).toContain(
      'Shorthand reasoning is unavailable'
    )
    const temperature = available.find(({ id }) => id === 'temperature')!
    expect(temperature.type).toBe('short-input')
    expect(temperature.min).toBeUndefined()
    expect(temperature.max).toBeUndefined()
    expect(AgentBlock.subBlocks.some(({ id }) => ['verbosity', 'thinkingLevel'].includes(id))).toBe(
      false
    )
  })

  it('preserves unknown versus explicit unsupported helper data', () => {
    useModelRegistry.setState({ providers })
    expect(getReasoningEffortValues('example/plain')).toEqual([])
    expect(getReasoningEffortValues('example/unknown')).toBeUndefined()
    expect(getRegistryModel('example/plain')?.temperature).toBe(false)
    expect(getRegistryModel('example/unknown')?.temperature).toBeUndefined()
    expect(fields('example/plain').map(({ id }) => id)).not.toContain('reasoningEffort')
    expect(fields('example/plain').map(({ id }) => id)).not.toContain('temperature')
    expect(fields('example/unknown').map(({ id }) => id)).toEqual(
      expect.arrayContaining(['reasoningOptions', 'temperature'])
    )
  })

  it.each(['<variable.model>', '{{MODEL}}', '<upstream.model>', 'example/{{MODEL}}'])(
    'keeps unresolved %s editable',
    (model) => {
      useModelRegistry.setState({ providers })
      expect(fields(model).map(({ id }) => id)).toEqual(
        expect.arrayContaining(['reasoningOptions', 'temperature', 'maxTokens'])
      )
    }
  )

  it('shows actual budget bounds and toggles with native Provider Options rather than invented shorthands', () => {
    useModelRegistry.setState({
      providers: [
        {
          id: 'example',
          name: 'Example',
          models: [
            { id: 'example/budget', reasoning: [{ type: 'budget_tokens', min: 2048, max: 8192 }] },
            { id: 'example/toggle', reasoning: [{ type: 'toggle' }] },
          ],
        },
      ],
    })
    const budget = fields('example/budget')
    expect(budget.some(({ id }) => id === 'reasoningEffort')).toBe(false)
    const info = budget.find(({ id }) => id === 'reasoningOptions')!
    expect(info.value?.({ model: 'example/budget' })).toContain('minimum 2048, maximum 8192')
    expect(info.value?.({ model: 'example/toggle' })).toContain('on/off toggle')
    expect(budget.find(({ id }) => id === 'providerOptions')).toMatchObject({
      type: 'code',
      language: 'json',
      additional: true,
    })
  })

  it('keeps native Max Output Tokens available independently of metadata', () => {
    for (const model of ['example/plain', 'example/unknown', '<upstream.model>']) {
      const limits = fields(model).filter(({ id }) => id === 'maxTokens')
      expect(limits).toHaveLength(1)
      expect(limits[0]).toMatchObject({
        type: 'short-input',
        inputType: 'number',
        min: 1,
        integer: true,
      })
      expect(limits[0].max).toBeUndefined()
    }
  })

  it('preserves condition negation and dependencies through serialization', () => {
    useModelRegistry.setState({ providers })
    const condition = {
      field: 'model',
      operator: 'modelCapability',
      value: 'reasoningEffort',
      and: { field: 'enabled', value: true },
    } as const
    const restored = JSON.parse(JSON.stringify(condition))
    const values = { model: { id: 'example/effort' }, enabled: true }
    expect(evaluateSubBlockConditionValues(restored, values)).toBe(true)
    expect(evaluateSubBlockConditionValues(restored, { ...values, enabled: false })).toBe(false)
    expect(evaluateSubBlockConditionValues({ ...restored, not: true }, values)).toBe(false)
  })
})
