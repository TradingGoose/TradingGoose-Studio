import type React from 'react'
import { createElement, forwardRef } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'

const mockBlockState: Record<string, any> = {}
const mockBlockCatalog: Record<string, any> = {}
const mockSubBlockHookValues = new Map<string, unknown>()

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type, position }: { id: string; type: string; position: string }) =>
    createElement('div', {
      'data-testid': 'handle',
      'data-handle-id': id,
      'data-handle-type': type,
      'data-handle-position': position,
    }),
  Position: {
    Left: 'left',
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
  },
  useStore: () => 1,
  useUpdateNodeInternals: () => vi.fn(),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({
    canAdmin: true,
    canEdit: true,
    isOfflineMode: false,
  }),
}))

vi.mock('@/blocks/registry', () => ({
  registry: {},
}))

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => mockBlockCatalog[type],
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) =>
    createElement('span', props, children),
}))

vi.mock('@/components/ui/card', () => ({
  Card: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function MockCard(
    { children, ...props },
    ref
  ) {
    return createElement('div', { ...props, ref }, children)
  }),
}))

vi.mock('@/components/ui/popover', () => ({
  PopoverEnvironmentProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipEnvironmentProvider: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({
    collaborativeSetSubblockValue: vi.fn(),
    collaborativeUpdateBlockName: vi.fn(),
  }),
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useBlock: (blockId: string) => mockBlockState[blockId] ?? null,
  useBlockProtection: () => false,
  useWorkflowMutations: () => ({
    updateBlockLayoutMetrics: vi.fn(),
  }),
}))

vi.mock('@/stores/execution/store', () => ({
  selectWorkflowExecutionState: () => ({
    activeBlockIds: new Set<string>(),
    isExecuting: false,
    isDebugging: false,
    pendingBlocks: [],
    autoPanDisabled: false,
  }),
  useExecutionStore: (selector?: (state: any) => unknown) =>
    typeof selector === 'function' ? selector({ byWorkflowId: {} }) : false,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/action-bar/action-bar',
  () => ({
    ActionBar: () => createElement('div', { 'data-testid': 'action-bar' }),
  })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/connection-blocks/connection-blocks',
  () => ({
    ConnectionBlocks: () => createElement('div', { 'data-testid': 'connection-blocks' }),
  })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: (blockId: string, subBlockId: string) => [
      mockSubBlockHookValues.get(`${blockId}:${subBlockId}`),
      vi.fn(),
    ],
  })
)

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus',
  () => ({
    subscribeScheduleUpdated: () => () => {},
  })
)

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowId: () => 'workflow-1',
}))

import { WorkflowBlock } from './workflow-block'

const renderWithLocale = (element: React.ReactElement, locale: 'es' | 'en' | 'zh' = 'es') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
      {element}
    </NextIntlClientProvider>
  )

describe('WorkflowBlock localization', () => {
  it('localizes editable tool block labels and selected values through the real locale provider', () => {
    mockBlockCatalog.apify = { name: 'Apify' }
    mockBlockState.apify_block = {
      id: 'apify_block',
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode: false,
      subBlocks: {
        operation: { value: 'apify_run_actor_async' },
        input: { value: '{ "startUrl": "https://example.com", "maxPages": 10 }' },
        build: { value: 'latest' },
      },
    }
    mockSubBlockHookValues.clear()

    const markup = renderWithLocale(
      createElement(WorkflowBlock as any, {
        id: 'apify_block',
        selected: false,
        data: {
          type: 'apify',
          name: 'Apify',
          isPreview: false,
          config: {
            type: 'apify',
            category: 'tools',
            bgColor: '#6366F1',
            icon: (props: any) => createElement('svg', props),
            subBlocks: [
              {
                id: 'operation',
                title: 'Operation',
                type: 'dropdown',
                options: [
                  { id: 'apify_run_actor_sync', label: 'Run Actor' },
                  { id: 'apify_run_actor_async', label: 'Run Actor (Async)' },
                ],
              },
              {
                id: 'input',
                title: 'Actor Input',
                type: 'code',
              },
              {
                id: 'build',
                title: 'Build',
                type: 'short-input',
              },
            ],
          },
        },
      })
    )

    expect(markup).toContain('Operación')
    expect(markup).toContain('Ejecutar actor (asíncrono)')
    expect(markup).toContain('Entrada del actor')
    expect(markup).toContain('Compilación')
  })

  it('localizes condition labels and block chrome badges in the editable canvas block', () => {
    mockBlockCatalog.condition = { name: 'Condition' }
    mockBlockState.condition_block = {
      id: 'condition_block',
      enabled: false,
      locked: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode: false,
      subBlocks: {
        conditions: {
          value: JSON.stringify([
            { id: 'if-1', value: 'price > 10' },
            { id: 'elseif-1', value: 'price > 5' },
            { id: 'else-1', value: 'fallback' },
          ]),
        },
      },
    }
    mockSubBlockHookValues.clear()

    const markup = renderWithLocale(
      createElement(WorkflowBlock as any, {
        id: 'condition_block',
        selected: false,
        data: {
          type: 'condition',
          name: 'Condition',
          isPreview: false,
          isPending: true,
          config: {
            type: 'condition',
            category: 'blocks',
            bgColor: '#f59e0b',
            icon: (props: any) => createElement('svg', props),
            subBlocks: [
              {
                id: 'conditions',
                title: 'Conditions',
                type: 'short-input',
              },
            ],
          },
        },
      })
    )

    expect(markup).toContain('Condition')
    expect(markup).toContain('Siguiente paso')
    expect(markup).toContain('Bloqueado')
    expect(markup).toContain('Deshabilitado')
    expect(markup).toContain('si')
    expect(markup).toContain('sino si')
    expect(markup).toContain('sino')
  })

  it('localizes workflow deployment status fallback text in the editable canvas block', () => {
    mockBlockCatalog.workflow = { name: 'Workflow' }
    mockBlockState.workflow_block = {
      id: 'workflow_block',
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode: false,
      subBlocks: {
        workflowId: { value: 'child-workflow' },
      },
    }
    mockSubBlockHookValues.clear()
    mockSubBlockHookValues.set('workflow_block:workflowId', 'child-workflow')

    const markup = renderWithLocale(
      createElement(WorkflowBlock as any, {
        id: 'workflow_block',
        selected: false,
        data: {
          type: 'workflow',
          name: 'Workflow',
          isPreview: false,
          config: {
            type: 'workflow',
            category: 'blocks',
            bgColor: '#2563eb',
            icon: (props: any) => createElement('svg', props),
            subBlocks: [],
          },
        },
      })
    )

    expect(markup).toContain('No desplegado')
  })
})
