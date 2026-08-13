import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ConsoleEntry } from '@/stores/console/types'
import { OutputPanel } from './output-panel'

vi.mock('@/blocks', () => ({ getBlock: () => null }))
vi.mock('@/i18n/workspace-widget-hooks', () => ({
  useWorkflowConsoleMessages: () => new Proxy({}, { get: (_target, property) => String(property) }),
}))

const baseEntry: ConsoleEntry = {
  id: 'entry-1',
  timestamp: '2026-08-07T15:16:34.200Z',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  blockId: 'wait-1',
  blockName: 'Wait',
  blockType: 'wait',
  success: false,
  durationMs: 20_000,
  startedAt: '2026-08-07T15:16:14.200Z',
  endedAt: '2026-08-07T15:16:34.200Z',
}

describe('OutputPanel', () => {
  it('renders structured deadline diagnostics through the localized messages', () => {
    const markup = renderToStaticMarkup(
      <OutputPanel
        entry={{
          ...baseEntry,
          error: 'persisted English deadline error',
          code: 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED',
          deadline: {
            appliedTierId: 'tier-pro',
            appliedTierName: 'Pro',
            limitSeconds: 20,
            processingStartedAt: '2026-08-07T15:16:14.200Z',
            terminatedAt: '2026-08-07T15:16:34.200Z',
          },
        }}
        consoleWidth={640}
      />
    )

    expect(markup).toContain('Workflow execution time limit exceeded')
    expect(markup).toContain('Applied limit: 20 seconds')
    expect(markup).toContain('Applied tier: Pro')
    expect(markup).not.toContain('persisted English deadline error')
  })

  it('preserves generic error rendering', () => {
    const markup = renderToStaticMarkup(
      <OutputPanel entry={{ ...baseEntry, error: 'Provider failed' }} consoleWidth={640} />
    )

    expect(markup).toContain('Provider failed')
    expect(markup).not.toContain('Workflow execution time limit exceeded')
  })
})
