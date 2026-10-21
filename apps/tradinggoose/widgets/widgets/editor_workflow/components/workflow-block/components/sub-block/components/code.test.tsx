/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
import type { IRange } from 'monaco-editor'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { buildInitialSubBlockStates, stringifySubBlockValue } from '@/lib/workflows/subblock-values'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { createYjsUndoTrackedOrigins, YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createWorkflowSnapshot,
  extractPersistedStateFromDoc,
  readWorkflowSubBlockFieldsMap,
  readWorkflowTextField,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSessionContextValue } from '@/lib/yjs/workflow-session-host'
import { AgentBlock } from '@/blocks/blocks/agent'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { Code } from './code'

type ReactEditorProps = {
  value?: string
  onChange?: (value?: string) => void
  onMount?: (editor: any, monaco: any) => void
}
const mocks = vi.hoisted(() => {
  let loadBinding!: () => void
  return {
    session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
    model: null as ReturnType<typeof createModel> | null,
    bindingLoaded: new Promise<void>((resolve) => {
      loadBinding = resolve
    }),
    loadBinding: () => loadBinding(),
  }
})

function createModel(initial: string) {
  let value = initial
  type Change = { rangeOffset: number; rangeLength: number; text: string }
  const listeners = new Set<(event: { changes: Change[] }) => void>()
  const model = {
    uri: { toString: () => 'inmemory://model/test.json' },
    getLanguageId: () => 'json',
    getValue: () => value,
    getValueLength: () => value.length,
    getOffsetAt: ({ column }: { lineNumber: number; column: number }) => column - 1,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    setValue(next: string, notify = true) {
      if (value === next) return
      const change = { rangeOffset: 0, rangeLength: value.length, text: next }
      value = next
      if (notify) listeners.forEach((listener) => listener({ changes: [change] }))
    },
    applyEdits(edits: Array<{ range: IRange; text: string }>) {
      for (const { range, text } of edits) {
        const start = model.getOffsetAt({
          lineNumber: range.startLineNumber,
          column: range.startColumn,
        })
        const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
        model.setValue(value.slice(0, start) + text + value.slice(end))
      }
    },
    onDidChangeContent(listener: (event: { changes: Change[] }) => void) {
      listeners.add(listener)
      return {
        dispose() {
          listeners.delete(listener)
        },
      }
    },
    onWillDispose: () => ({ dispose() {} }),
  }
  return model
}

vi.unmock('@/blocks/registry')
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => mocks.session,
  useWorkflowSession: () => mocks.session,
}))
vi.mock('next/dynamic', async () => {
  const { useEffect, useRef, useState } = await import('react')
  const monaco = await import('monaco-editor')
  return {
    default: () =>
      function MockReactEditor(props: ReactEditorProps) {
        const currentProps = useRef(props)
        currentProps.current = props
        const [model] = useState(() => createModel(props.value ?? ''))
        mocks.model = model
        useEffect(() => {
          const subscription = model.onDidChangeContent(() =>
            currentProps.current.onChange?.(model.getValue())
          )
          const noopSubscription = () => ({ dispose() {} })
          props.onMount?.(
            {
              getModel: () => model,
              getSelection: () => null,
              getPosition: () => null,
              getLayoutInfo: () => ({ width: 600, height: 100, contentLeft: 0 }),
              getOption: () => ({ top: 0 }),
              getContentHeight: () => 100,
              layout() {},
              deltaDecorations: () => [],
              ...Object.fromEntries(
                [
                  'onDidChangeCursorPosition',
                  'onKeyDown',
                  'onKeyUp',
                  'onMouseDown',
                  'onDidBlurEditorText',
                  'onDidFocusEditorText',
                  'onDidContentSizeChange',
                  'onDidLayoutChange',
                  'onDidChangeModelContent',
                ].map((name) => [name, noopSubscription])
              ),
            },
            monaco
          )
          return () => subscription.dispose()
        }, [model])
        useEffect(() => {
          if (props.value !== undefined) model.setValue(props.value, false)
        }, [model, props.value])
        return null
      },
  }
})
vi.mock('@monaco-editor/react', () => ({ loader: { config: vi.fn() } }))
vi.mock('monaco-editor', () => ({
  editor: {
    setTheme: vi.fn(),
    getModels: () => [],
    getModelMarkers: () => [],
    setModelMarkers: vi.fn(),
    setModelLanguage: vi.fn(),
    onDidChangeMarkers: () => ({ dispose() {} }),
    EditorOption: { padding: 0 },
  },
  typescript: undefined,
  languages: {},
}))
vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  Selection: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  },
}))
vi.mock('y-monaco', async () => {
  await mocks.bindingLoaded
  // Inline the binding so its Monaco dependency uses this test's SDK mock.
  return import('y-monaco?inline' as string) as Promise<typeof import('y-monaco')>
})
vi.mock('monaco-editor/esm/vs/language/json/monaco.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/language/css/monaco.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/language/html/monaco.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/language/typescript/monaco.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/basic-languages/python/python.contribution', () => ({}))
vi.mock('monaco-editor/esm/vs/basic-languages/sql/sql.contribution', () => ({}))
vi.mock('@/components/monaco-editor/monaco-editor-environment', () => ({
  ensureMonacoEnvironment: vi.fn(),
}))
vi.mock('@/components/monaco-editor/monaco-editor-theme', () => ({
  defineMonacoThemes: vi.fn(),
  getIsDark: () => false,
}))
vi.mock('@/components/ui/button', () => ({ Button: () => null }))
vi.mock('@/components/ui/env-var-dropdown', () => ({
  EnvVarDropdown: () => null,
  checkEnvVarTrigger: () => ({ show: false }),
}))
vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))
vi.mock('@/hooks/use-tag-selection', () => ({ useTagSelection: () => vi.fn() }))
vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => null,
}))
vi.mock('@/hooks/workflow/use-wand', () => ({ useWand: () => ({ isStreaming: false }) }))
vi.mock('@/hooks/workflow/use-workflow-editor-actions', () => ({
  useWorkflowEditorActions: () => ({ collaborativeSetSubblockValue: vi.fn() }),
}))
vi.mock('@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))
vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkspaceId: () => undefined,
}))
vi.mock('@/widgets/widgets/editor_workflow/copy', () => ({
  useWorkflowBlockEditorCopy: () => ({ code: {} }),
}))

const schema = {
  name: 'answer',
  schema: { type: 'object', properties: { answer: { type: 'string' } } },
}
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('Code workflow persistence', () => {
  let root: Root
  let doc: Y.Doc

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.model = null
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    doc = new Y.Doc()
    mocks.session = {
      doc,
      transactWorkflow: (fn, origin) => doc.transact(() => fn(doc), origin),
    }
    root = createRoot(document.createElement('div'))
  })

  afterEach(() => {
    act(() => root.unmount())
    doc.destroy()
    mocks.session = null
    vi.unstubAllGlobals()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function mount(
    initial: unknown,
    props: Partial<ComponentProps<typeof Code>> = {},
    deferBinding = false
  ) {
    if (!deferBinding) mocks.loadBinding()
    const state = createWorkflowSnapshot({
      blocks: {
        agent: {
          id: 'agent',
          type: AgentBlock.type,
          name: AgentBlock.name,
          enabled: true,
          position: { x: 0, y: 0 },
          outputs: {},
          subBlocks: buildInitialSubBlockStates(AgentBlock.subBlocks, {
            responseFormat: initial,
          }) as BlockState['subBlocks'],
        },
      },
    })
    expect(validateWorkflowState(state).errors).toEqual([])
    setWorkflowState(doc, state)
    await act(async () =>
      root.render(
        <Code
          blockId='agent'
          subBlockId='responseFormat'
          isConnecting={false}
          language='json'
          wandConfig={{ enabled: false, prompt: '' }}
          {...props}
        />
      )
    )
  }

  function stored() {
    return extractPersistedStateFromDoc(doc).blocks.agent.subBlocks.responseFormat.value
  }

  it('waits for the collaborative binding module before mounting a writable editor', async () => {
    const bindingModule = import('y-monaco')
    await mount(schema, {}, true)
    try {
      expect(mocks.model).toBeNull()
    } finally {
      await act(async () => {
        mocks.loadBinding()
        await bindingModule
        await vi.dynamicImportSettled()
      })
    }
    expect(mocks.model?.getValue()).toBe(stringifySubBlockValue(schema))
    expect(stored()).toEqual(schema)
  })

  it.each([
    ['object', schema],
    ['null', null],
  ] as const)(
    'persists manual edits from a stored %s and preserves undo history',
    async (_label, initial) => {
      await mount(initial)
      expect(mocks.model!.getValue()).toBe(stringifySubBlockValue(initial))
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
      expect(stored()).toEqual(initial)
      const undo = new Y.UndoManager(readWorkflowSubBlockFieldsMap(doc), {
        trackedOrigins: createYjsUndoTrackedOrigins(),
        captureTimeout: 0,
      })
      const write = vi.spyOn(doc, 'transact')
      const edited = '{"answer":"a"}'
      act(() => mocks.model!.setValue(edited))
      expect(stored()).toBe(edited)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeInstanceOf(Y.Text)
      expect(write).toHaveBeenCalledOnce()
      expect(write.mock.calls[0][1]).toBe(YJS_ORIGINS.USER)

      write.mockClear()
      const next = '{"answer":"ab"}'
      act(() => mocks.model!.setValue(next))
      expect(stored()).toBe(next)
      expect(mocks.model!.getValue()).toBe(next)
      expect(write).toHaveBeenCalledOnce()
      expect(write.mock.calls[0][1]).not.toBe(YJS_ORIGINS.USER)

      act(() => undo.undo())
      expect(stored()).toEqual(initial)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
      expect(mocks.model!.getValue()).toBe(stringifySubBlockValue(initial))
      act(() => undo.redo())
      expect(stored()).toBe(next)
      expect(mocks.model!.getValue()).toBe(next)
      const text = readWorkflowTextField(doc, 'agent', 'responseFormat')!
      write.mockClear()
      act(() => doc.transact(() => text.insert(text.length, ' '), YJS_ORIGINS.USER))
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBe(text)
      expect(stored()).toBe(`${next} `)
      expect(mocks.model!.getValue()).toBe(`${next} `)
      expect(write).toHaveBeenCalledOnce()
      undo.destroy()
    }
  )

  it.each([{ readOnly: true }, { disabled: true }, { value: 'preview' }])(
    'does not persist edits from a noneditable or externally controlled editor: %j',
    async (props) => {
      await mount(schema, props)
      act(() => mocks.model!.setValue('{}'))
      expect(stored()).toEqual(schema)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
    }
  )
})
