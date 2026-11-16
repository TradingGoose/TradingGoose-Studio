import { afterEach, describe, expect, it } from 'vitest'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import { getWorkflowInspectorCopy } from '@/i18n/block-editor'
import { useModelRegistry } from '@/stores/model-registry'
import { buildTriggerEditingLayout } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout'
import { AgentBlock } from './agent'
import { EvaluatorBlock } from './evaluator'
import { GuardrailsBlock } from './guardrails'
import { RouterBlock } from './router'
import { TranslateBlock } from './translate'
import { VisionBlock } from './vision'

const original = useModelRegistry.getState()
const providers = [
  {
    id: 'example',
    name: 'Example Models',
    models: [
      {
        id: 'example/capable',
        temperature: true,
        structuredOutput: true,
        toolCall: true,
        reasoning: true,
      },
      {
        id: 'example/plain',
        temperature: false,
        structuredOutput: false,
        toolCall: false,
        reasoning: false,
      },
      { id: 'example/unknown' },
    ],
  },
]
afterEach(() => useModelRegistry.setState(original))
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
      expect(options.map(({ id }) => id)).toEqual(
        block === AgentBlock
          ? ['example/capable', 'example/unknown']
          : ['example/capable', 'example/plain', 'example/unknown']
      )
      expect(options[0]).toMatchObject({
        label: 'capable',
        group: 'example',
        searchLabel: 'example/capable Example Models',
      })
      const groups = typeof field.optionGroups === 'function' ? field.optionGroups() : []
      expect(groups).toEqual([
        { id: 'example', label: 'Example Models', icon: expect.any(Function) },
      ])
      const apiKey = block.subBlocks.find(({ id }) => id === 'apiKey')!
      expect(apiKey.password).toBe(true)
      for (const managedProviders of [[], ['example'], ['other']]) {
        useModelRegistry.setState({ managedProviders })
        expect(evaluateSubBlockConditionValues(apiKey.required, { model: 'example/capable' })).toBe(
          !managedProviders.includes('example')
        )
        expect(evaluateSubBlockConditionValues(apiKey.required, { model: 'unlisted/model' })).toBe(
          true
        )
      }
      useModelRegistry.setState({ providers: [], managedProviders: ['example'] })
      expect(evaluateSubBlockConditionValues(apiKey.required, { model: 'example/capable' })).toBe(
        true
      )
      useModelRegistry.setState({ providers, managedProviders: [] })
    }
  })

  it('uses unset native model settings', () => {
    useModelRegistry.setState({ providers })
    const available = fields('example/capable')
    for (const id of [
      'memories',
      'responseFormat',
      'temperature',
      'providerOptions',
      'maxTokens',
      'maxSteps',
    ]) {
      const field = available.find((entry) => entry.id === id)!
      expect(field.additional).toBe(true)
      expect(field.defaultValue).toBeUndefined()
      expect(field.value).toBeUndefined()
    }
    const temperature = available.find(({ id }) => id === 'temperature')!
    expect(temperature.type).toBe('short-input')
    expect(temperature.min).toBeUndefined()
    expect(temperature.max).toBeUndefined()
    expect(available.find(({ id }) => id === 'providerOptions')).toMatchObject({
      type: 'code',
      language: 'json',
      condition: { field: 'model', operator: 'modelCapability', value: 'reasoning' },
    })
    expect(
      AgentBlock.subBlocks.some(({ id }) =>
        ['reasoningOptions', 'reasoningEffort', 'verbosity', 'thinkingLevel'].includes(id)
      )
    ).toBe(false)
  })

  it.each(['temperature', 'responseFormat', 'providerOptions'])(
    'gates %s only on explicit native non-support',
    (id) => {
      useModelRegistry.setState({ providers })
      expect(fields('example/capable').map((field) => field.id)).toContain(id)
      expect(fields('example/plain').map((field) => field.id)).not.toContain(id)
      expect(fields('example/unknown').map((field) => field.id)).toContain(id)
      expect(fields('example/unlisted').map((field) => field.id)).toContain(id)
      expect(fields('').map((field) => field.id)).not.toContain(id)
    }
  )

  it.each(['<variable.model>', '{{MODEL}}', '<upstream.model>', 'example/{{MODEL}}'])(
    'keeps unresolved %s editable',
    (model) => {
      useModelRegistry.setState({ providers })
      expect(fields(model).map(({ id }) => id)).toEqual(
        expect.arrayContaining([
          'responseFormat',
          'temperature',
          'providerOptions',
          'maxTokens',
          'maxSteps',
        ])
      )
    }
  )

  it.each([
    ['maxTokens', 1],
    ['maxSteps', 1],
  ] as const)('keeps native %s available independently of metadata', (id, min) => {
    for (const model of ['example/plain', 'example/unknown', '<upstream.model>']) {
      const limits = fields(model).filter((field) => field.id === id)
      expect(limits).toHaveLength(1)
      expect(limits[0]).toMatchObject({
        type: 'short-input',
        inputType: 'number',
        min,
        integer: true,
      })
      expect(limits[0].max).toBeUndefined()
      expect(limits[0].defaultValue).toBeUndefined()
    }
  })

  it('preserves condition negation and dependencies through serialization', () => {
    useModelRegistry.setState({ providers })
    const condition = {
      field: 'model',
      operator: 'modelCapability',
      value: 'structuredOutput',
      and: { field: 'enabled', value: true },
    } as const
    const restored = JSON.parse(JSON.stringify(condition))
    const values = { model: { id: 'example/capable' }, enabled: true }
    expect(evaluateSubBlockConditionValues(restored, values)).toBe(true)
    expect(evaluateSubBlockConditionValues(restored, { ...values, enabled: false })).toBe(false)
    expect(evaluateSubBlockConditionValues({ ...restored, not: true }, values)).toBe(false)
  })
})
