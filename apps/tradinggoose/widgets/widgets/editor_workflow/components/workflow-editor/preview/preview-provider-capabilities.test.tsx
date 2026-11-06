/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import type { SubBlockConfig } from '@/blocks/types'
import {
  getReasoningEffortValuesForModel,
  PROVIDER_DEFINITIONS,
  updateOpenRouterModels,
} from '@/providers/ai/models'
import { getOpenRouterModels } from '@/providers/ai/openrouter/models'
import { useProvidersStore } from '@/stores/providers/store'
import { PreviewNode } from './preview-node'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))
vi.mock('@/blocks', () => ({ getBlock: () => undefined }))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => {
  const localizeWorkflowSubBlockConfig = (config: SubBlockConfig) => config
  return { useWorkflowI18n: () => ({ localizeWorkflowSubBlockConfig }) }
})
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows',
  () => ({
    SubBlockSummaryRows: ({ subBlocks }: { subBlocks: SubBlockConfig[] }) =>
      subBlocks.map((field) => <div key={field.id}>{field.title}</div>),
    PrecomputedSubBlockSummaryRows: () => null,
  })
)

it.each(['empty', 'unavailable'])(
  'refreshes mounted preview rows through execution discovery after an initially %s catalog',
  async (initial) => {
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousAct = environment.IS_REACT_ACT_ENVIRONMENT
    const originalModels = PROVIDER_DEFINITIONS.openrouter.models
    const originalProviders = useProvidersStore.getState().providers
    const model = 'openrouter/test/model'
    const container = document.createElement('div')
    const root = createRoot(container)
    environment.IS_REACT_ACT_ENVIRONMENT = true
    const values = {
      model: { value: model },
      reasoningEffort: { value: 'high' },
      verbosity: { value: 'high' },
      thinkingLevel: { value: 'high' },
    }
    const storedValues = structuredClone(values)
    const node = (
      <PreviewNode
        {...({
          id: 'agent',
          data: { type: 'agent', name: 'Agent', config: AgentBlock, subBlockValues: values },
        } as any)}
      />
    )
    const noCapabilities = { models: [model], pricing: {}, capabilities: {} }
    const supported = {
      ...noCapabilities,
      capabilities: {
        [model]: { reasoningEffort: { values: ['high'] }, verbosity: { values: ['high'] } },
      },
    }
    const request = vi.mocked(fetch)
    request.mockReset()
    request
      .mockResolvedValueOnce(
        initial === 'empty'
          ? Response.json({ models: [], pricing: {}, capabilities: {} })
          : Response.json({ error: 'Unavailable' }, { status: 502 })
      )
      .mockResolvedValueOnce(Response.json(noCapabilities))
      .mockResolvedValueOnce(Response.json(supported))
      .mockResolvedValueOnce(Response.json(noCapabilities))

    try {
      updateOpenRouterModels([])
      act(() => root.render(node))
      expect(container.textContent).not.toContain('Reasoning Effort')
      expect(container.textContent).not.toContain('Verbosity')
      expect(container.textContent).not.toContain('Thinking Level')

      await act(async () => {
        if (initial === 'unavailable') {
          await expect(getOpenRouterModels()).rejects.toThrow('HTTP 502')
        } else {
          await getOpenRouterModels()
        }
      })
      expect(container.textContent).not.toContain('Reasoning Effort')
      expect(container.textContent).not.toContain('Verbosity')

      await act(async () => {
        await getOpenRouterModels()
      })
      expect(container.textContent).not.toContain('Reasoning Effort')
      expect(container.textContent).not.toContain('Verbosity')
      const previousPublication = useProvidersStore.getState().providers

      await act(async () => {
        await getOpenRouterModels()
      })
      expect(getReasoningEffortValuesForModel(model)).toEqual(['high'])
      expect(container.textContent).toContain('Reasoning Effort')
      expect(container.textContent).toContain('Verbosity')
      expect(container.textContent).not.toContain('Thinking Level')
      expect(useProvidersStore.getState().providers).not.toBe(previousPublication)
      expect(useProvidersStore.getState().providers.openrouter.models).toEqual([model])
      const supportedPublication = useProvidersStore.getState().providers

      await act(async () => {
        await getOpenRouterModels()
      })
      expect(container.textContent).not.toContain('Reasoning Effort')
      expect(container.textContent).not.toContain('Verbosity')
      expect(container.textContent).not.toContain('Thinking Level')
      expect(useProvidersStore.getState().providers).not.toBe(supportedPublication)
      expect(useProvidersStore.getState().providers.openrouter.models).toEqual([model])
      expect(values).toEqual(storedValues)
      expect(request).toHaveBeenCalledTimes(4)
      for (const [url] of request.mock.calls) {
        expect(url).toBe('/api/providers/ai/openrouter/models')
      }
    } finally {
      act(() => root.unmount())
      PROVIDER_DEFINITIONS.openrouter.models = originalModels
      useProvidersStore.setState({ providers: originalProviders })
      environment.IS_REACT_ACT_ENVIRONMENT = previousAct
      request.mockReset()
    }
  }
)
