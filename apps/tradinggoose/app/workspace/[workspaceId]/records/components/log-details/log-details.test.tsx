import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowLog } from '@/lib/logs/types'
import { LogDetails } from './log-details'

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: () => null,
}))

vi.mock(
  '@/app/workspace/[workspaceId]/records/components/log-details/components/execution-snapshot/frozen-canvas-modal',
  () => ({ FrozenCanvasModal: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/records/components/log-details/components/file-download/file-download',
  () => ({ FileDownload: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/records/components/log-details/components/tool-calls/tool-calls-display',
  () => ({ ToolCallsDisplay: () => null })
)
vi.mock(
  '@/app/workspace/[workspaceId]/records/components/log-details/components/trace-spans/trace-spans',
  () => ({ TraceSpans: () => null })
)

const createLog = (executionData: WorkflowLog['executionData']): WorkflowLog => ({
  id: 'log-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  level: 'error',
  trigger: 'manual',
  createdAt: '2026-08-07T15:16:14.200Z',
  durationMs: 20_000,
  executionData,
})

describe('LogDetails', () => {
  it('renders localized structured deadline diagnostics', () => {
    const markup = renderToStaticMarkup(
      <LogDetails
        log={createLog({
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
        })}
        isOpen
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('Workflow execution time limit exceeded')
    expect(markup).toContain(
      'This execution was stopped because it reached the time limit configured for its billing tier.'
    )
    expect(markup).toContain('Applied limit: 20 seconds')
    expect(markup).toContain('Applied tier: Pro')
    expect(markup).not.toContain('persisted English deadline error')
  })

  it('preserves the raw error for non-deadline failures', () => {
    const markup = renderToStaticMarkup(
      <LogDetails log={createLog({ errorMessage: 'Provider failed' })} isOpen onClose={vi.fn()} />
    )

    expect(markup).toContain('Provider failed')
    expect(markup).not.toContain('Workflow execution time limit exceeded')
  })
})
