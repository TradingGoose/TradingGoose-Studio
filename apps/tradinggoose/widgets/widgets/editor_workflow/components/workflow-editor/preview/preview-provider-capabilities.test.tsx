/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'
import type { SubBlockConfig } from '@/blocks/types'
import { useModelRegistry } from '@/stores/model-registry'
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
it('refreshes mounted preview fields from registry metadata without rewriting saved values', () => {
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previousAct = environment.IS_REACT_ACT_ENVIRONMENT
  const previous = useModelRegistry.getState().providers
  const container = document.createElement('div')
  const root = createRoot(container)
  environment.IS_REACT_ACT_ENVIRONMENT = true
  const values = {
    model: { value: 'example/model' },
    reasoningEffort: { value: 'high' },
    temperature: { value: '0.4' },
    maxTokens: { value: 42 },
  }
  const saved = structuredClone(values)
  const publish = (reasoning: [] | [{ type: 'effort'; values: string[] }], temperature: boolean) =>
    useModelRegistry.setState({
      providers: [
        {
          id: 'example',
          name: 'Example',
          models: [{ id: 'example/model', reasoning, temperature }],
        },
      ],
    })
  try {
    publish([], false)
    act(() =>
      root.render(
        <PreviewNode
          {...({
            id: 'agent',
            data: { type: 'agent', name: 'Agent', config: AgentBlock, subBlockValues: values },
          } as any)}
        />
      )
    )
    expect(container.textContent).not.toContain('Reasoning Effort')
    expect(container.textContent).not.toContain('Temperature')
    act(() => publish([{ type: 'effort', values: ['high'] }], true))
    expect(container.textContent).not.toContain('Reasoning Effort')
    expect(container.textContent).toContain('Temperature')
    expect(container.textContent).toContain('Max Output Tokens')
    act(() => publish([], false))
    expect(container.textContent).not.toContain('Reasoning Effort')
    expect(container.textContent).not.toContain('Temperature')
    expect(container.textContent).toContain('Max Output Tokens')
    expect(values).toEqual(saved)
  } finally {
    act(() => root.unmount())
    useModelRegistry.setState({ providers: previous })
    environment.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
