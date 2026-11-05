/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { useBlock } from '@/lib/yjs/use-workflow-doc'
import {
  readWorkflowSnapshot,
  setWorkflowState,
  setWorkflowSubBlockValues,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { AgentBlock } from '@/blocks/blocks/agent'
import { MODEL_CONTROL_GETTERS, type ModelControl } from '@/providers/ai/models'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { ComboBox, resolveComboBoxDisplayValue } from './combobox'

const mocks = vi.hoisted(() => ({
  session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
}))

vi.mock('@xyflow/react', () => ({ useReactFlow: () => null }))
vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: () => null,
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
}))
vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))
vi.mock('@/components/ui/formatted-text', () => ({ formatDisplayText: (value: string) => value }))
vi.mock('@/hooks/use-tag-selection', () => ({ useTagSelection: () => vi.fn() }))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
  useWorkspaceId: () => 'workspace',
}))
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => mocks.session,
  useWorkflowSession: () => mocks.session,
}))

it.each([
  ['xhigh', false, false, true, ''],
  ['xhigh', true, false, true, 'xhigh'],
  ['xhigh', false, true, true, 'xhigh'],
  ['xhigh', false, false, false, 'xhigh'],
  ['<variable.effort>', false, false, true, '<variable.effort>'],
  ['{{REASONING_EFFORT}}', false, false, true, '{{REASONING_EFFORT}}'],
] as const)(
  'resolves model-control display value %#',
  (value, selected, typed, capability, expected) => {
    expect(resolveComboBoxDisplayValue(value, selected, typed, capability)).toBe(expected)
  }
)

function AgentChooser({ field }: { field: ModelControl }) {
  const state = useBlock('agent')?.subBlocks ?? {}
  const config = buildSubBlockRows({
    subBlocks: AgentBlock.subBlocks,
    stateToUse: state,
    isAdvancedMode: false,
    isTriggerMode: false,
    isPureTriggerBlock: false,
  })
    .flat()
    .find((entry) => entry.id === field)
  if (!config || typeof config.options !== 'function') return null
  return (
    <ComboBox
      blockId='agent'
      subBlockId={field}
      config={config}
      options={config.options({ model: state.model?.value })}
      isConnecting={false}
    />
  )
}

describe('Agent tuning chooser interactions', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc
  let field: ModelControl
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    vi.useFakeTimers()
    environment.IS_REACT_ACT_ENVIRONMENT = true
    doc = new Y.Doc()
    mocks.session = {
      doc,
      transactWorkflow: (fn, origin) => doc.transact(() => fn(doc), origin),
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    doc.destroy()
    mocks.session = null
    vi.useRealTimers()
    environment.IS_REACT_ACT_ENVIRONMENT = false
  })

  function update(values: Record<string, unknown>) {
    act(() => {
      setWorkflowSubBlockValues(
        doc,
        Object.entries(values).map(([subBlockId, value]) => ({
          blockId: 'agent',
          subBlockId,
          value,
        }))
      )
    })
  }

  function input() {
    return container.querySelector('input')!
  }

  function open() {
    act(() => input().focus())
  }

  function close() {
    act(() => {
      input().blur()
      vi.runOnlyPendingTimers()
    })
  }

  function type(value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input(),
        value
      )
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function options() {
    return Array.from(container.querySelectorAll('[data-option-index] span')).map(
      (option) => option.textContent
    )
  }

  function expectedOptions(model: string) {
    return ['Auto (provider default)', ...(MODEL_CONTROL_GETTERS[field](model) ?? [])]
  }

  it.each([
    ['reasoningEffort', 'gpt-5.4', 'mistral-small-2603'],
    ['verbosity', 'gpt-5.4', 'gpt-5.6-sol'],
    ['thinkingLevel', 'gemini-2.5-flash', 'claude-haiku-4-5'],
  ] as const)(
    'keeps %s editable through saved values, model changes and searches',
    (id, model, nextModel) => {
      field = id
      setWorkflowState(doc, {
        blocks: {
          agent: {
            id: 'agent',
            type: 'agent',
            name: 'Agent',
            position: { x: 0, y: 0 },
            enabled: true,
            outputs: {},
            subBlocks: buildInitialSubBlockStates(AgentBlock.subBlocks, {
              model,
              [field]: '',
            }) as BlockState['subBlocks'],
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      })
      act(() => root.render(<AgentChooser field={field} />))
      open()
      expect(options()).toEqual(expectedOptions(model))
      expect(input().value).toBe('')

      const medium = Array.from(container.querySelectorAll('[data-option-index]')).find(
        (option) => option.textContent === 'medium'
      )!
      act(() => medium.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('medium')
      act(() => root.render(<AgentChooser key='reload' field={field} />))
      open()
      expect(input().value).toBe('medium')
      expect(options()).toEqual(expectedOptions(model))

      update({ model: nextModel })
      expect(options()).toEqual(expectedOptions(nextModel))
      update({ [field]: 'unavailable-level' })
      expect(input().value).toBe('')
      expect(options()).toEqual(expectedOptions(nextModel))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe(
        'unavailable-level'
      )

      const auto = container.querySelector('[data-option-index]')!
      act(() => auto.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
      open()
      type('')
      close()
      open()
      expect(options()).toEqual(expectedOptions(nextModel))
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('')
      type('definitely-no-match')
      expect(container.textContent).toContain('No matching options found')
      expect(options()).toEqual([])
      close()
      open()
      expect(options()).toEqual(expectedOptions(nextModel))

      for (const reference of ['<variable.model>', '{{MODEL}}', '<upstream.model>']) {
        update({ model: reference, [field]: '<variable.effort>' })
        close()
        open()
        expect(input().value).toBe('<variable.effort>')
        expect(options()).toEqual(['Auto (provider default)'])
        type('{{EFFORT}}')
        expect(input().value).toBe('{{EFFORT}}')
        expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('{{EFFORT}}')
      }

      update({ model: 'gpt-4.1' })
      expect(container.querySelector('input')).toBeNull()
      expect(readWorkflowSnapshot(doc)?.blocks.agent.subBlocks[field].value).toBe('{{EFFORT}}')
    }
  )
})
