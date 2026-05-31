/**
 * @vitest-environment jsdom
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'

let mockSelectedBlock: any = {
  id: 'agent-1',
  type: 'agent',
  name: 'Agent',
  enabled: true,
  subBlocks: {},
}
let mockSelectedLoop: any = null
let mockSelectedParallel: any = null
let mockBlockProtection = false
const mockCollaborativeUpdateBlockName = vi.fn(() => true)
let mockBlockConfig: any = {
  category: 'blocks',
  name: 'Agent',
  bgColor: '#2873f6',
  icon: (props: Record<string, unknown>) => createElement('svg', props),
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'Enter system prompt...',
    },
    {
      id: 'userPrompt',
      title: 'User Prompt',
      type: 'long-input',
      placeholder: 'Enter context or user message...',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      placeholder: 'Type or select a model...',
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
    },
    {
      id: 'skills',
      title: 'Skills',
      type: 'skill-input',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your API key',
    },
    {
      id: 'responseFormat',
      title: 'Response Format',
      type: 'code',
      placeholder: 'Enter JSON schema...',
    },
  ],
}

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) =>
    createElement('section', { 'data-testid': 'panel' }, children),
}))

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
  useMessages: () => getPublicCopy('es'),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('button', props, children),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => createElement('input', props),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: { children?: ReactNode }) =>
    createElement('label', props, children),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'select' }, children),
  SelectContent: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectItem: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectTrigger: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    createElement('span', { 'data-testid': 'select-value' }, placeholder),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => createElement('textarea', props),
}))

vi.mock('@/lib/ui/icon-colors', () => ({
  getIconTileStyle: () => ({}),
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useBlock: () => mockSelectedBlock,
  useLoop: () => mockSelectedLoop,
  useParallel: () => mockSelectedParallel,
  useBlockProtection: () => mockBlockProtection,
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true }),
}))

vi.mock('@/blocks', () => ({
  getBlock: () => mockBlockConfig,
}))

vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({
    collaborativeToggleBlockAdvancedMode: vi.fn(),
    collaborativeUpdateBlockName: mockCollaborativeUpdateBlockName,
    collaborativeUpdateIterationCollection: vi.fn(),
    collaborativeUpdateIterationCount: vi.fn(),
    collaborativeUpdateLoopType: vi.fn(),
    collaborativeUpdateParallelType: vi.fn(),
  }),
}))

vi.mock('@/widgets/widgets/editor_workflow/components/subflows/config', () => ({
  getSubflowBlockConfig: () => undefined,
  getSubflowPanelCopy: () => null,
}))

vi.mock('@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-edit-rows', () => ({
  SubBlockEditRows: ({
    rows,
  }: {
    rows: Array<Array<{ id: string; title?: string; placeholder?: string }>>
  }) =>
    createElement(
      'div',
      { 'data-testid': 'rows' },
      rows.flat().map((subBlock) =>
        createElement(
          'span',
          {
            key: subBlock.id,
            'data-testid': 'row',
            'data-title': subBlock.title,
            'data-placeholder': subBlock.placeholder ?? '',
          },
          `${subBlock.title ?? ''}|${subBlock.placeholder ?? ''}`
        )
      )
    ),
}))

import { NodeEditorPanel } from './node-editor-panel'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('NodeEditorPanel', () => {
  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container?.remove()
    container = null
    mockCollaborativeUpdateBlockName.mockReset()
    mockCollaborativeUpdateBlockName.mockImplementation(() => true)
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    mockSelectedBlock = {
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      enabled: true,
      subBlocks: {},
    }
    mockSelectedLoop = null
    mockSelectedParallel = null
    mockBlockProtection = false
    mockBlockConfig = {
      category: 'blocks',
      name: 'Agent',
      bgColor: '#2873f6',
      icon: (props: Record<string, unknown>) => createElement('svg', props),
      subBlocks: [
        {
          id: 'systemPrompt',
          title: 'System Prompt',
          type: 'long-input',
          placeholder: 'Enter system prompt...',
        },
        {
          id: 'userPrompt',
          title: 'User Prompt',
          type: 'long-input',
          placeholder: 'Enter context or user message...',
        },
        {
          id: 'model',
          title: 'Model',
          type: 'combobox',
          placeholder: 'Type or select a model...',
        },
        {
          id: 'temperature',
          title: 'Temperature',
          type: 'slider',
        },
        {
          id: 'tools',
          title: 'Tools',
          type: 'tool-input',
        },
        {
          id: 'skills',
          title: 'Skills',
          type: 'skill-input',
        },
        {
          id: 'apiKey',
          title: 'API Key',
          type: 'short-input',
          placeholder: 'Enter your API key',
        },
        {
          id: 'responseFormat',
          title: 'Response Format',
          type: 'code',
          placeholder: 'Enter JSON schema...',
        },
      ],
    }
  })

  it('renders localized block titles and sub-block copy through the shared row builder', () => {
    mockSelectedBlock = {
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      enabled: true,
      subBlocks: {},
    }

    const markup = renderToStaticMarkup(
      createElement(NodeEditorPanel, {
        selectedNodeId: 'agent-1',
      })
    )

    expect(markup).toContain('Agente')
    expect(markup).toContain('Prompt del sistema')
    expect(markup).toContain('Prompt del usuario')
    expect(markup).toContain('Modelo')
    expect(markup).toContain('Temperatura')
    expect(markup).toContain('Herramientas')
    expect(markup).toContain('Habilidades')
    expect(markup).toContain('Clave API')
    expect(markup).toContain('Formato de respuesta')
    expect(markup).not.toContain('System Prompt')
    expect(markup).not.toContain('User Prompt')
    expect(markup).not.toContain('Temperature')
    expect(markup).not.toContain('API Key')
    expect(markup).not.toContain('Response Format')
  })

  it('keeps the localized rename editor open when saving a changed name fails', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mockCollaborativeUpdateBlockName.mockReturnValue(false)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        createElement(NodeEditorPanel, {
          selectedNodeId: 'agent-1',
        })
      )
    })

    const renameButton = container.querySelector(
      'button[aria-label="Rename node"]'
    ) as HTMLButtonElement | null

    await act(async () => {
      renameButton?.dispatchEvent(
        new globalThis.MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    const input = container.querySelector('input[type="text"]') as HTMLInputElement | null

    expect(input?.value).toBe('Agente')

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'Nuevo nombre')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(mockCollaborativeUpdateBlockName).toHaveBeenCalledWith('agent-1', 'Nuevo nombre')
    expect(container.querySelector('input[type="text"]')).toBeTruthy()
    expect((container.querySelector('input[type="text"]') as HTMLInputElement | null)?.value).toBe(
      'Nuevo nombre'
    )
    expect(container.querySelector('button[aria-label="Save name"]')).toBeTruthy()
  })

  it('closes the localized rename editor without saving when the name is unchanged', async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        createElement(NodeEditorPanel, {
          selectedNodeId: 'agent-1',
        })
      )
    })

    const renameButton = container.querySelector(
      'button[aria-label="Rename node"]'
    ) as HTMLButtonElement | null

    await act(async () => {
      renameButton?.dispatchEvent(
        new globalThis.MouseEvent('click', { bubbles: true, cancelable: true })
      )
    })

    const input = container.querySelector('input[type="text"]') as HTMLInputElement | null

    expect(input?.value).toBe('Agente')

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(mockCollaborativeUpdateBlockName).not.toHaveBeenCalled()
    expect(container.querySelector('input[type="text"]')).toBeNull()
    expect(container.textContent).toContain('Agente')
  })

  it('renders the missing-node fallback instead of crashing when the selected block is absent', () => {
    mockSelectedBlock = null

    const markup = renderToStaticMarkup(
      createElement(NodeEditorPanel, {
        selectedNodeId: 'missing-node',
      })
    )

    expect(markup).toContain('No se encontró el nodo')
  })

  it('renders localized trigger empty-state copy instead of the legacy English fallback', () => {
    mockSelectedBlock = {
      id: 'trigger-1',
      type: 'generic_webhook',
      name: 'Generic Webhook',
      enabled: true,
      subBlocks: {},
    }
    mockBlockConfig = {
      category: 'triggers',
      name: 'Generic Webhook',
      bgColor: '#2873f6',
      icon: (props: Record<string, unknown>) => createElement('svg', props),
      subBlocks: [],
    }

    const markup = renderToStaticMarkup(
      createElement(NodeEditorPanel, {
        selectedNodeId: 'trigger-1',
      })
    )

    expect(markup).toContain('Este disparador no tiene campos editables en el panel.')
    expect(markup).not.toContain('This trigger has no editable fields in the panel.')
  })
})
