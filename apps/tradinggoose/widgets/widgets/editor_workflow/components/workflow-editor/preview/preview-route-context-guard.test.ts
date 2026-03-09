import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/components/workflow-preview/workflow-preview'
import { DeployedWorkflowCard } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-card'
import { DeployedWorkflowModal } from '@/widgets/widgets/editor_workflow/components/control-bar/components/deployment-controls/components/deployed-workflow-modal'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function createWorkflowState(): WorkflowState {
  return {
    blocks: {
      block_1: {
        id: 'block_1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {} as any,
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }
}

describe('preview route-context guards', () => {
  it('keeps workflow-preview renderer free from route-context fallback gates', () => {
    const filePath = 'app/workspace/[workspaceId]/components/workflow-preview/workflow-preview.tsx'
    const content = fs.readFileSync(path.join(process.cwd(), filePath), 'utf8')

    expect(content.includes('useOptionalWorkflowRoute')).toBe(false)
    expect(content.includes('WorkflowRouteProvider')).toBe(false)
    expect(content.includes('Unable to render preview')).toBe(false)
    expect(content.includes('requires a workspace and workflow identifier')).toBe(false)
  })

  it('renders preview without route context when workspace/workflow ids are absent', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowPreview, {
        workflowState: createWorkflowState(),
        height: 300,
        width: 400,
      })
    )

    expect(html).not.toContain('Unable to render preview')
    expect(html).not.toContain('requires a workspace and workflow identifier')
  })

  it('deployed preview wrappers render without route-context providers', () => {
    const state = createWorkflowState()

    expect(() =>
      renderToStaticMarkup(
        createElement(DeployedWorkflowCard, {
          workflowId: 'wf_guard',
          activeDeployedWorkflowState: state,
        })
      )
    ).not.toThrow()

    expect(() =>
      renderToStaticMarkup(
        createElement(DeployedWorkflowModal, {
          isOpen: true,
          onClose: () => {},
          needsRedeployment: false,
          activeDeployedState: state,
          workflowId: 'wf_guard',
        })
      )
    ).not.toThrow()
  })
})
