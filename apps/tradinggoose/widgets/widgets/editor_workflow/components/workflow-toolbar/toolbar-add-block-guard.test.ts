import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { WorkflowToolbar } from './workflow-toolbar'

const toolbarMocks = vi.hoisted(() => ({
  canEdit: true,
  dispatch: vi.fn(),
  onAddBlock: null as null | ((request: { type: string }) => void),
}))

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useLocale: () => 'en',
  useMessages: () => getPublicCopy('en'),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  WorkspacePermissionsProvider: ({ children }: { children: ReactNode }) => children,
  useUserPermissionsContext: () => ({ canEdit: toolbarMocks.canEdit }),
}))
vi.mock('@/lib/workflows/trigger-utils', () => ({
  getBlocksForSidebar: () => [],
  getTriggersForSidebar: () => [],
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-context',
  () => ({
    ToolbarAddBlockProvider: ({ children, onAddBlock }: any) => {
      toolbarMocks.onAddBlock = onAddBlock
      return children
    },
  })
)
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-toolbar/toolbar-add-block-dispatcher',
  () => ({
    dispatchToolbarAddBlock: toolbarMocks.dispatch,
  })
)

describe('workflow toolbar edit guard', () => {
  beforeEach(() => {
    toolbarMocks.dispatch.mockReset()
  })

  const renderToolbar = (accessMode: 'read' | 'write', canEdit: boolean) => {
    toolbarMocks.canEdit = canEdit
    return renderToStaticMarkup(
      createElement(WorkflowToolbar, {
        accessMode,
        toolbarScopeId: 'panel-1',
        workspaceId: 'workspace-1',
      })
    )
  }

  it.each([
    ['review reader', 'read' as const, true],
    ['workspace reader', 'write' as const, false],
  ])('keeps %s controls and dispatch disabled', (_label, accessMode, canEdit) => {
    const markup = renderToolbar(accessMode, canEdit)

    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(3)
    toolbarMocks.onAddBlock?.({ type: 'agent' })
    expect(toolbarMocks.dispatch).not.toHaveBeenCalled()
  })

  it('enables controls and dispatch for a workspace writer', () => {
    const markup = renderToolbar('write', true)

    expect(markup).not.toContain('disabled=""')
    toolbarMocks.onAddBlock?.({ type: 'agent' })
    expect(toolbarMocks.dispatch).toHaveBeenCalledWith({ type: 'agent' }, 'panel-1')
  })

  it('keeps the canvas dispatch guard and removed DOM-event path canonical', () => {
    const root = resolve(process.cwd(), 'widgets/widgets/editor_workflow')
    let canvas = ''
    for (const file of [
      'components/workflow-editor/workflow-canvas.tsx',
      'components/toolbar/toolbar-block/toolbar-block.tsx',
      'components/toolbar/toolbar-loop-block/toolbar-loop-block.tsx',
      'components/toolbar/toolbar-parallel-block/toolbar-parallel-block.tsx',
      'components/workflow-toolbar/workflow-toolbar.tsx',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8')
      if (file.endsWith('workflow-canvas.tsx')) canvas = source
      expect(source).not.toContain('add-block-from-toolbar')
    }
    expect(canvas).toContain("workflowSession?.accessMode === 'write' && userPermissions.canEdit")
    expect(canvas).toContain('if (!canMutateWorkflow)')
  })
})
