/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act, createElement, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setStoreValue = vi.fn()
const mockStoredValue = JSON.stringify([
  { id: 'condition_block-if', title: 'if', value: 'price > 10' },
  { id: 'condition_block-elseif', title: 'else if', value: 'price > 5' },
  { id: 'condition_block-else', title: 'else', value: 'fallback' },
])

vi.mock('next-intl', () => ({
  useLocale: () => 'es',
}))

vi.mock('@xyflow/react', () => ({
  useUpdateNodeInternals: () => vi.fn(),
}))

vi.mock('@/components/monaco-editor', () => ({
  MonacoEditor: forwardRef(function MockMonacoEditor(props: any, ref) {
    useImperativeHandle(ref, () => ({
      focus: vi.fn(),
      getCursorOffset: () => 0,
      setCursorOffset: vi.fn(),
      getEditor: () => ({
        getValue: () => props.value ?? '',
      }),
    }))

    return createElement('textarea', {
      'data-testid': 'monaco-editor',
      defaultValue: props.value,
      placeholder: props.placeholder,
      readOnly: props.readOnly,
    })
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', props, children),
}))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: () => null,
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/hooks/use-tag-selection', () => ({
  useTagSelection: () => vi.fn(),
}))

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowEdges: () => [],
  useWorkflowMutations: () => ({
    removeEdge: vi.fn(),
  }),
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  () => ({
    useSubBlockValue: () => [mockStoredValue, setStoreValue],
  })
)

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkspaceId: () => 'workspace-1',
}))

vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({
    conditionInput: {
      loadingConditions: 'Cargando condiciones...',
      addBlock: 'Agregar bloque',
      moveUp: 'Mover arriba',
      moveDown: 'Mover abajo',
      deleteBlock: 'Eliminar bloque',
      deleteCondition: 'Eliminar condición',
      placeholder: 'Escribe una condición...',
    },
  }),
}))

import {
  applyConditionBlockTitles,
  CONDITION_BRANCH_TITLES,
  ConditionInput,
} from './condition-input'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('ConditionInput', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    setStoreValue.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps persisted condition branch tokens as stable internal identifiers', () => {
    expect(CONDITION_BRANCH_TITLES).toEqual({
      if: 'if',
      elseIf: 'else if',
      else: 'else',
    })

    expect(
      applyConditionBlockTitles([
        { id: 'first', title: 'ignored' },
        { id: 'middle', title: 'ignored' },
        { id: 'last', title: 'ignored' },
      ]).map((block) => block.title)
    ).toEqual(['if', 'else if', 'else'])
  })

  it('renders visible condition labels in the active locale', async () => {
    await act(async () => {
      root.render(
        createElement(ConditionInput, {
          blockId: 'condition_block',
          subBlockId: 'conditions',
          isConnecting: false,
        })
      )
    })

    expect(container.textContent).toContain('si')
    expect(container.textContent).toContain('sino si')
    expect(container.textContent).toContain('sino')
    expect(setStoreValue).not.toHaveBeenCalled()
  })
})
