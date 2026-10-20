/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react'
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

type ReactEditorProps = { value?: string; onChange?: (value?: string) => void }
const mocks = vi.hoisted(() => ({
  session: null as Pick<WorkflowSessionContextValue, 'doc' | 'transactWorkflow'> | null,
  editor: {} as ReactEditorProps,
  contentListener: undefined as ReactEditorProps['onChange'],
}))

vi.unmock('@/blocks/registry')
vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () => mocks.session,
  useWorkflowSession: () => mocks.session,
}))
vi.mock('next/dynamic', async () => {
  const { useEffect } = await import('react')
  return {
    default: () =>
      function MockReactEditor(props: ReactEditorProps) {
        mocks.editor = props
        useEffect(() => {
          // @monaco-editor/react retains its previous listener when onChange is absent.
          if (props.onChange) mocks.contentListener = props.onChange
        }, [props.onChange])
        return null
      },
  }
})
vi.mock('@monaco-editor/react', () => ({ loader: { config: vi.fn() } }))
vi.mock('monaco-editor', () => ({
  editor: { setTheme: vi.fn() },
  typescript: undefined,
  languages: {},
}))
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
    mocks.contentListener = undefined
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
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function mount(initial: unknown, props: Partial<ComponentProps<typeof Code>> = {}) {
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

  it.each([
    ['object', schema],
    ['null', null],
  ] as const)(
    'persists manual edits from a stored %s and preserves undo history',
    async (_label, initial) => {
      await mount(initial)
      expect(mocks.editor.value).toBe(stringifySubBlockValue(initial))
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
      expect(stored()).toEqual(initial)
      const undo = new Y.UndoManager(readWorkflowSubBlockFieldsMap(doc), {
        trackedOrigins: createYjsUndoTrackedOrigins(),
        captureTimeout: 0,
      })
      const write = vi.spyOn(doc, 'transact')
      const edited = JSON.stringify({ name: 'edited', schema: { type: 'object' } })
      act(() => mocks.contentListener!(edited))
      expect(stored()).toBe(edited)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeInstanceOf(Y.Text)
      expect(write).toHaveBeenCalledOnce()
      expect(write.mock.calls[0][1]).toBe(YJS_ORIGINS.USER)

      act(() => undo.undo())
      expect(stored()).toEqual(initial)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
      act(() => undo.redo())
      expect(stored()).toBe(edited)
      const text = readWorkflowTextField(doc, 'agent', 'responseFormat')!
      write.mockClear()
      act(() => mocks.contentListener!(`${edited} `))
      expect(write).not.toHaveBeenCalled()
      act(() => doc.transact(() => text.insert(text.length, ' '), YJS_ORIGINS.USER))
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBe(text)
      expect(stored()).toBe(`${edited} `)
      expect(write).toHaveBeenCalledOnce()
      undo.destroy()
    }
  )

  it.each([{ readOnly: true }, { disabled: true }, { value: 'preview' }])(
    'does not persist edits from a noneditable or externally controlled editor: %j',
    async (props) => {
      await mount(schema, props)
      act(() => mocks.contentListener!('{}'))
      expect(stored()).toEqual(schema)
      expect(readWorkflowTextField(doc, 'agent', 'responseFormat')).toBeNull()
    }
  )
})
