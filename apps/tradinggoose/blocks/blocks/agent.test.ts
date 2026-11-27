import { afterEach, describe, expect, it } from 'vitest'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'
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
        structuredOutput: true,
        toolCall: true,
        reasoningOptions: [
          {
            type: 'effort' as const,
            values: ['low' as const, 'high' as const],
            defaultValue: 'high' as const,
          },
        ],
      },
      {
        id: 'example/plain',
        structuredOutput: false,
        toolCall: false,
        reasoningOptions: [],
      },
      { id: 'example/unknown' },
    ],
  },
]
afterEach(() => useModelRegistry.setState(original))
const layout = (model: string) =>
  buildTriggerEditingLayout({
    inspectorCopy: getWorkflowInspectorCopy('en'),
    blockType: 'agent',
    blockConfig: AgentBlock,
    blockState: { subBlocks: { model: { value: model } } },
    shouldDisableWrite: false,
  })
const fields = (model: string) => {
  const rows = layout(model)
  return [...rows.regularRows, ...rows.additionalRows].flat()
}

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
    for (const id of ['memories', 'responseFormat']) {
      const field = available.find((entry) => entry.id === id)!
      expect(field.additional).toBe(true)
      expect(field.defaultValue).toBeUndefined()
      expect(field.value).toBeUndefined()
    }
    expect(AgentBlock.inputs).not.toHaveProperty('temperature')
    expect(available.find(({ id }) => id === 'reasoningMode')).toBeUndefined()
    const effort = available.find(({ id }) => id === 'reasoningEffort')
    expect(effort?.required).toBeFalsy()
    expect(effort?.autoSelectFirstOption).not.toBe(false)
    expect(effort).toMatchObject({
      type: 'combobox',
      title: 'Reasoning Effort',
    })
    expect(effort?.value?.({ model: 'example/capable' })).toBe('high')
    expect(AgentBlock.subBlocks.every(({ layout }) => layout === 'full')).toBe(true)
    const ids = AgentBlock.subBlocks.map(({ id }) => id)
    for (const id of [
      'temperature',
      'reasoningOptions',
      'providerOptions',
      'verbosity',
      'thinkingLevel',
    ])
      expect(ids).not.toContain(id)
  })

  it('gates response format only on explicit native non-support or an empty model', () => {
    useModelRegistry.setState({ providers })
    for (const model of ['example/capable', 'example/unknown', 'example/unlisted'])
      expect(fields(model).map((field) => field.id)).toContain('responseFormat')
    for (const model of ['example/plain', ''])
      expect(fields(model).map((field) => field.id)).not.toContain('responseFormat')
  })

  it.each(['example/unknown', 'example/unlisted', 'example/plain', ''])(
    'hides reasoning with no requestable settings for %s',
    (model) => {
      useModelRegistry.setState({ providers })
      expect(fields(model).map((field) => field.id)).not.toContain('reasoningEffort')
    }
  )
  it.each(['openai/gpt-5', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-4o'])(
    'places the runtime reasoning options for %s directly below Model',
    (id) => {
      const options = getReasoningOptions(id) ?? []
      const [provider] = id.split('/')
      useModelRegistry.setState({
        providers: [{ id: provider, name: provider, models: [{ id, reasoningOptions: options }] }],
      })
      const rows = layout(id)
      expect(rows.displayAdditionalFields).toBe(false)
      expect(rows.additionalRows.flat().some((field) => field.id.startsWith('reasoning'))).toBe(
        false
      )
      const controls = rows.regularRows.flat().filter((field) => field.id.startsWith('reasoning'))
      expect(controls).toHaveLength(options.length)
      for (const option of options) {
        const field = controls.find(
          ({ condition }) => typeof condition === 'object' && condition.value === option.type
        )!
        const modelRow = rows.regularRows.findIndex((row) => row.some(({ id }) => id === 'model'))
        expect(rows.regularRows[modelRow + 1]).toEqual([field])
        expect(field.value?.({ model: id })).toBe(option.defaultValue)
        expect(typeof field.options === 'function' && field.options({ model: id })).toEqual(
          option.values.map((id) => ({ id, label: id }))
        )
      }
    }
  )

  it.each(['<variable.model>', '{{MODEL}}', '<upstream.model>', 'example/{{MODEL}}'])(
    'keeps unresolved %s editable',
    (model) => {
      useModelRegistry.setState({ providers })
      expect(fields(model).map(({ id }) => id)).toEqual(
        expect.arrayContaining(['responseFormat', 'reasoningEffort'])
      )
    }
  )

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
