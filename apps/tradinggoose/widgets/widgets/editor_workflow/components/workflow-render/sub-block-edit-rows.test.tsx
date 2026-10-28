/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { JiraBlock } from '@/blocks/blocks/jira'
import type { SubBlockConfig } from '@/blocks/types'
import { getWorkflowInspectorCopy } from '@/i18n/block-editor'
import { localizeWorkflowSubBlockConfigWithCopy } from '@/i18n/workflow-inspector-core'
import { SubBlockEditRows } from './sub-block-edit-rows'

const control = vi.hoisted(() => vi.fn((_props: unknown) => null))

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
