/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoopBlock } from '@/blocks/blocks/loop'
import { ParallelContainerBlock } from '@/blocks/blocks/parallel_container'
import type { SubBlockConfig } from '@/blocks/types'
import { ShortInput } from './short-input'

const mocks = vi.hoisted(() => ({ commit: vi.fn() }))

vi.mock('@xyflow/react', () => ({ useReactFlow: () => null }))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: ({ visible }: { visible: boolean }) =>
    visible ? <div data-reference-picker='environment' /> : null,
  checkEnvVarTrigger: (value: string) => ({ show: value.includes('{{'), searchTerm: '' }),
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: ({ visible }: { visible: boolean }) =>
    visible ? <div data-reference-picker='workflow' /> : null,
  checkTagTrigger: (value: string) => ({ show: value.includes('<') }),
}))

vi.mock('@/components/ui/formatted-text', () => ({ formatDisplayText: (value: string) => value }))
vi.mock('@/hooks/use-tag-selection', () => ({ useTagSelection: () => vi.fn() }))
vi.mock('@/hooks/use-webhook-management', () => ({
  useWebhookManagement: () => ({ webhookUrl: '' }),
}))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))
vi.mock('@/hooks/workflow/use-wand', () => ({ useWand: () => ({ isStreaming: false }) }))
vi.mock('@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({ shortInput: {} }),
}))

vi.mock('@/lib/yjs/use-workflow-doc', async () => {
  const { useCallback, useState } = await import('react')
  return {
    useWorkflowTextField: (_blockId: string, _subBlockId: string, initialValue: string) => {
      const [value, setValue] = useState(initialValue)
      const commit = useCallback((nextValue: string) => {
        mocks.commit(nextValue)
        setValue(nextValue)
      }, [])
      return { value, setValue: commit }
    },
  }
})

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ShortInput numeric contract', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.commit.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  function render(config: SubBlockConfig, onChange?: (value: string) => void) {
    act(() => {
      root.render(
        <ShortInput
          blockId='container'
          subBlockId={config.id}
          config={config}
          value={config.defaultValue ?? '5'}
          isConnecting={false}
          onChange={onChange}
        />
      )
    })
    return container.querySelector('input')!
  }

  function type(input: HTMLInputElement, value: string) {
    act(() => {
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it.each([
    ['Loop', LoopBlock, 'iterations', 100],
    ['Parallel', ParallelContainerBlock, 'count', 20],
  ] as const)('bounds %s count before committing', (_name, block, id, max) => {
    const config = block.subBlocks.find((field) => field.id === id)!
    const input = render(config)
    type(input, '1000')
    expect(mocks.commit).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(300))
    expect(mocks.commit).toHaveBeenLastCalledWith(String(max))

    act(() => input.blur())
    expect(input.value).toBe(String(max))
  })

  it.each([
    ['-10', '1'],
    ['4.7', '5'],
    ['1e999', '100'],
  ])('normalizes literal %s on blur to %s', (value, expected) => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    type(input, value)
    act(() => input.blur())
    expect(mocks.commit).toHaveBeenLastCalledWith(expected)
    expect(input.value).toBe(expected)
  })

  it('bounds a pending count when the editor unmounts before debounce or blur', () => {
    const input = render(ParallelContainerBlock.subBlocks.find((field) => field.id === 'count')!)
    type(input, '1000')
    act(() => root.render(null))
    expect(mocks.commit).toHaveBeenCalledExactlyOnceWith('20')
    act(() => vi.advanceTimersByTime(300))
    expect(mocks.commit).toHaveBeenCalledTimes(1)
  })

  it.each(['<variable.count>', '{{COUNT}}', '', 'text'])(
    'rejects invalid count %j without changing the saved value',
    (value) => {
      const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
      type(input, value)
      expect(container.querySelector('[data-reference-picker]')).toBeNull()
      act(() => input.blur())
      expect(mocks.commit).not.toHaveBeenCalled()
      expect(input.value).toBe('5')
    }
  )

  it('preserves the last committed literal when unmounting with a pasted reference', () => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    type(input, '7')
    act(() => input.blur())
    mocks.commit.mockClear()

    type(input, '<variable.count>')
    act(() => root.render(null))
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('ignores reference drops on fields that declare no reference support', () => {
    const input = render(LoopBlock.subBlocks.find((field) => field.id === 'iterations')!)
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { getData: () => JSON.stringify({ type: 'connectionBlock' }) },
    })
    act(() => input.dispatchEvent(drop))
    expect(input.value).toBe('5')
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it.each(['<variable.startTime>', '{{START_TIME}}', '', '1e'])(
    'preserves reference or incomplete numeric text %j',
    (value) => {
      const input = render({ id: 'startTs', type: 'short-input', inputType: 'number', min: 1 })
      type(input, value)
      act(() => input.blur())
      expect(mocks.commit).toHaveBeenLastCalledWith(value)
    }
  )

  it('preserves fractional numeric values for controlled short inputs', () => {
    const onChange = vi.fn()
    const input = render(
      { id: 'speed', type: 'short-input', inputType: 'number', min: 0.25, max: 4 },
      onChange
    )
    type(input, '1.5')
    act(() => input.blur())
    expect(onChange).toHaveBeenLastCalledWith('1.5')
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('does not apply numeric constraints to text inputs', () => {
    const input = render({ id: 'text', type: 'short-input', integer: true, min: 1, max: 20 })
    type(input, '1000')
    act(() => input.blur())
    expect(mocks.commit).toHaveBeenLastCalledWith('1000')
  })
})
