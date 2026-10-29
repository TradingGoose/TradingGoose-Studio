/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import { JiraBlock } from '@/blocks/blocks/jira'
import { SpotifyBlock } from '@/blocks/blocks/spotify'
import type { SubBlockConfig } from '@/blocks/types'
import { getWorkflowInspectorCopy } from '@/i18n/block-editor'
import { localizeWorkflowSubBlockConfigWithCopy } from '@/i18n/workflow-inspector-core'
import { spotifySetVolumeTool } from '@/tools/spotify/set_volume'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'
import { SubBlockEditRows } from './sub-block-edit-rows'

const control = vi.hoisted(() => vi.fn((_props: unknown) => null))
const sliderState = vi.hoisted(() => ({ value: undefined as unknown, write: vi.fn() }))

vi.mock('@/components/ui/slider', () => ({ Slider: control }))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({ useSubBlockValue: () => [sliderState.value, sliderState.write] })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components',
  () => ({
    Dropdown: control,
    ComboBox: control,
  })
)

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowInspectorCopy: () => ({ workflowEditor: {} }),
}))

describe('SubBlockEditRows', () => {
  it.each(['dropdown', 'combobox'] as const)(
    'updates localized %s options using full context and active-mode Jira project IDs',
    (type) => {
      const options = vi.fn((params?: Record<string, any>) => [
        { id: params?.model, label: params?.model },
      ])
      const config = localizeWorkflowSubBlockConfigWithCopy(
        getWorkflowInspectorCopy('es'),
        { id: 'reasoningEffort', type, additional: true, options },
        'agent'
      )
      const subBlockConfigs: SubBlockConfig[] = [
        { id: 'model', type: 'combobox' },
        ...JiraBlock.subBlocks,
        config,
      ]
      const container = document.createElement('div')
      const root = createRoot(container)
      const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

      try {
        for (const [model, isAdvancedMode, manualProjectId, projectId] of [
          ['first-model', false, '', 'PROJ'],
          ['second-model', true, 'MANUAL', 'MANUAL'],
        ] as const) {
          act(() => {
            root.render(
              <SubBlockEditRows
                blockId='agent-1'
                rows={[[config]]}
                subBlockConfigs={subBlockConfigs}
                isAdvancedMode={isAdvancedMode}
                stateToUse={{
                  model: { value: model },
                  projectId: { value: 'PROJ' },
                  manualProjectId: { value: manualProjectId },
                }}
                disabled={false}
                rowKeyPrefix='additional'
              />
            )
          })

          expect(options).toHaveBeenLastCalledWith({ model, projectId })
          expect(control.mock.lastCall?.[0]).toMatchObject({
            options: [{ id: model, label: model }],
          })
        }
      } finally {
        act(() => root.unmount())
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
      }
    }
  )
})

describe('slider fields', () => {
  let root: Root
  let container: HTMLDivElement
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
  const config: SubBlockConfig = {
    id: 'temperature',
    title: 'Temperature',
    type: 'slider',
    min: 0,
    max: 2,
    clearable: true,
    placeholder: 'Use the provider default',
  }
  const render = (value: unknown, overrides: Partial<SubBlockConfig> = {}, disabled = false) => {
    sliderState.value = value
    const field = { ...config, ...overrides }
    act(() =>
      root.render(
        <SubBlockEditRows
          blockId='agent'
          rows={[[field]]}
          stateToUse={{ [field.id]: { value } }}
          disabled={disabled}
          rowKeyPrefix='slider'
        />
      )
    )
    return control.mock.lastCall![0] as {
      value: number[]
      onValueChange: (value: number[]) => void
    }
  }
  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    sliderState.write.mockReset()
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it.each([undefined, null, '', '   ', '<start.temperature>', '{{TEMPERATURE}}'])(
    'preserves unset and referenced values without writes: %s',
    (value) => {
      expect(render(value).value).toEqual([1])
      expect(sliderState.write).not.toHaveBeenCalled()
      expect(container.textContent).toContain(
        typeof value === 'string' && value.trim() ? value : config.placeholder!
      )
    }
  )

  it.each([
    [0, 0],
    ['0', 0],
    ['0.3', 0.3],
    [-1, 0],
    [3, 2],
  ] as const)(
    'displays numeric %s at %s and persists only bound corrections',
    (value, expected) => {
      expect(render(value).value).toEqual([expected])
      expect(container.textContent).toContain(expected.toFixed(1))
      if (Number(value) === expected) expect(sliderState.write).not.toHaveBeenCalled()
      else expect(sliderState.write).toHaveBeenCalledExactlyOnceWith(expected)
    }
  )

  it('uses the declared default without persisting a clearable value', () => {
    expect(render(undefined, { defaultValue: 0.3 }).value).toEqual([0.3])
    expect(container.textContent).toContain('0.3')
    expect(sliderState.write).not.toHaveBeenCalled()
  })

  it('persists the displayed volume for a fresh Spotify Set Volume block', () => {
    const volume = SpotifyBlock.subBlocks.find((field) => field.id === 'volume_percent')!
    const state = buildInitialSubBlockStates(SpotifyBlock.subBlocks, {
      operation: 'spotify_set_volume',
    })
    const validate = () =>
      validateRequiredParametersAfterMerge(spotifySetVolumeTool.id, spotifySetVolumeTool, {
        volume_percent: state.volume_percent.value,
      })
    expect(validate).toThrow('"Volume Percent" is required')
    sliderState.write.mockImplementation((value) => {
      state.volume_percent.value = value
    })
    expect(render(state.volume_percent.value, { ...volume, clearable: false }).value).toEqual([50])
    expect(sliderState.write).toHaveBeenCalledExactlyOnceWith(50)
    expect(state.volume_percent.value).toBe(50)
    expect(container.textContent).toContain('50')
    expect(validate).not.toThrow()
  })

  it('persists the displayed integer midpoint for a nonclearable slider', () => {
    expect(render('', { min: 1, max: 50, integer: true, clearable: false }).value).toEqual([26])
    expect(sliderState.write).toHaveBeenCalledExactlyOnceWith(26)
    expect(container.textContent).toContain('26')
  })

  it('writes numeric zero on interaction and clears back to unset', () => {
    const slider = render('')
    act(() => slider.onValueChange([0]))
    expect(sliderState.write).toHaveBeenCalledExactlyOnceWith(0)
    render(0)
    act(() => container.querySelector('button')!.click())
    expect(sliderState.write).toHaveBeenLastCalledWith('')
  })

  it('respects integer and disabled settings', () => {
    const integerSlider = render(0, { integer: true })
    act(() => integerSlider.onValueChange([1.6]))
    expect(sliderState.write).toHaveBeenLastCalledWith(2)
    sliderState.write.mockClear()
    const slider = render(3, {}, true)
    expect(slider.value).toEqual([2])
    act(() => slider.onValueChange([0]))
    expect(container.querySelector('button')!.disabled).toBe(true)
    act(() => container.querySelector('button')!.click())
    expect(sliderState.write).not.toHaveBeenCalled()
    render('', { clearable: false }, true)
    expect(sliderState.write).not.toHaveBeenCalled()
  })
})
