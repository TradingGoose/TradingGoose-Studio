/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import type { SubBlockConfig } from '@/blocks/types'
import { PROVIDER_DEFINITIONS, updateOpenRouterModels } from '@/providers/ai/models'
import { useProvidersStore } from '@/stores/providers/store'
import { PreviewNode } from './preview-node'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))
vi.mock('@/blocks', () => ({ getBlock: () => undefined }))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowI18n: () => ({ localizeWorkflowSubBlockConfig: (config: SubBlockConfig) => config }),
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows',
  () => ({
    SubBlockSummaryRows: ({ subBlocks }: { subBlocks: SubBlockConfig[] }) =>
      subBlocks.map((field) => <div key={field.id}>{field.title}</div>),
    PrecomputedSubBlockSummaryRows: () => null,
  })
)

it('refreshes memoized preview capability rows when provider discovery changes without a workflow edit', () => {
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
  const node = (
    <PreviewNode
      {...({
        id: 'agent',
        data: { type: 'agent', name: 'Agent', config: AgentBlock, subBlockValues: values },
      } as any)}
    />
  )

  try {
    updateOpenRouterModels([])
    act(() => root.render(node))
    expect(container.textContent).not.toContain('Reasoning Effort')
    expect(container.textContent).not.toContain('Verbosity')
    expect(container.textContent).not.toContain('Thinking Level')

    act(() => {
      updateOpenRouterModels([model], undefined, {
        [model]: {
          reasoningEffort: { values: ['high'] },
          verbosity: { values: ['high'] },
          thinking: { levels: ['high'] },
        },
      })
      useProvidersStore.setState({
        providers: {
          ...originalProviders,
          openrouter: { ...originalProviders.openrouter, models: [model] },
        },
      })
    })
    expect(container.textContent).toContain('Reasoning Effort')
    expect(container.textContent).toContain('Verbosity')
    expect(container.textContent).toContain('Thinking Level')

    act(() => {
      updateOpenRouterModels([model])
      useProvidersStore.setState({ providers: { ...originalProviders } })
    })
    expect(container.textContent).not.toContain('Reasoning Effort')
    expect(container.textContent).not.toContain('Verbosity')
    expect(container.textContent).not.toContain('Thinking Level')
  } finally {
    act(() => root.unmount())
    PROVIDER_DEFINITIONS.openrouter.models = originalModels
    useProvidersStore.setState({ providers: originalProviders })
    environment.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
