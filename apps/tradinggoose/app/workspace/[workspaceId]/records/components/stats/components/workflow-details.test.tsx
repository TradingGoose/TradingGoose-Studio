import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowLog } from '@/lib/logs/types'
import { WorkflowDetails } from './workflow-details'

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/app/workspace/[workspaceId]/records/components/stats/components/line-chart', () => ({
  default: () => null,
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: () => ({ workflows: {} }),
}))

const deadlineLog: WorkflowLog = {
  id: 'log-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  level: 'error',
  trigger: 'manual',
  createdAt: '2026-08-07T15:16:14.200Z',
  durationMs: 20_000,
  executionData: {
    errorMessage: 'persisted English deadline error',
    result: {
      error: 'persisted English deadline error',
      code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
      deadline: {
        appliedTierId: 'tier-pro',
        appliedTierName: 'Pro',
        limitSeconds: 20,
        processingStartedAt: '2026-08-07T15:16:14.200Z',
        terminatedAt: '2026-08-07T15:16:34.200Z',
      },
      logs: [],
    },
  },
}

describe('WorkflowDetails', () => {
  it('uses structured localized deadline diagnostics for execution errors', () => {
    const markup = renderToStaticMarkup(
      <WorkflowDetails
        workspaceId='workspace-1'
        expandedWorkflowId='workflow-1'
        workflowName='Workflow'
        overview={{ total: 1, success: 0, failures: 1, rate: 0 }}
        details={{
          errorRates: [],
          executionCounts: [],
          logs: [deadlineLog],
          allLogs: [deadlineLog],
        }}
        selectedSegmentIndex={null}
        selectedSegment={null}
        clearSegmentSelection={vi.fn()}
        formatCost={(value) => String(value)}
      />
    )

    expect(markup).toContain('Workflow execution time limit exceeded')
    expect(markup).toContain('Applied limit: 20 seconds')
    expect(markup).toContain('Applied tier: Pro')
    expect(markup).not.toContain('persisted English deadline error')
  })
})
