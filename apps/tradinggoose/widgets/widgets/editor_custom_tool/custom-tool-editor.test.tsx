/**
 * @vitest-environment jsdom
 */

import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  getEntityFields,
  replaceEntityTextField,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import {
  CUSTOM_TOOL_EDITOR_ACTION_EVENT,
  type CustomToolEditorActionEventDetail,
} from '@/widgets/events'
import { emitEditorAction } from '@/widgets/utils/editor-actions'
import { CustomToolEditor } from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'

const mockUseWand = vi.fn()
const editorMocks = vi.hoisted(() => ({
  checkEnvVarTrigger: vi.fn((_text: string, _cursorPosition: number) => ({
    show: false,
    searchTerm: '',
  })),
  cursorChange: null as
    | ((offset: number, coords: { top: number; left: number; height: number } | null) => void)
    | null,
  envVarOnSelect: null as ((value: string) => void) | null,
  wandInputs: [] as Array<{ onStreamChunk?: (chunk: string) => void }>,
}))

vi.mock('@/hooks/workflow/use-wand', () => ({
  useWand: (...args: unknown[]) => mockUseWand(...args),
}))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  checkEnvVarTrigger: (text: string, cursorPosition: number) =>
    editorMocks.checkEnvVarTrigger(text, cursorPosition),
  EnvVarDropdown: ({ onSelect }: { onSelect: (value: string) => void }) => {
    editorMocks.envVarOnSelect = onSelect
    return <div data-testid='env-var-dropdown' />
  },
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  checkTagTrigger: () => ({ show: false }),
  TagDropdown: () => null,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    children?: React.ReactNode
    render?: React.ReactNode
  }) => <>{render ?? children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <span {...props}>{children}</span>
  ),
}))

vi.mock('@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor',
  () => ({
    CodeEditor: ({
      value,
      onChange,
      language,
      onCursorChange,
      disabled,
    }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
      value?: string
      onChange?: (value: string) => void
      language?: string
      onCursorChange?: (
        offset: number,
        coords: { top: number; left: number; height: number } | null
      ) => void
    }) => {
      editorMocks.cursorChange = onCursorChange ?? null
      return (
        <textarea
          data-testid={`code-editor-${language}`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
        />
      )
    },
  })
)

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkspaceId: () => 'workspace-1',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const createWandState = () => ({
  isLoading: false,
  isStreaming: false,
  isPromptVisible: false,
  promptInputValue: '',
  generateStream: vi.fn(),
  cancelGeneration: vi.fn(),
  hidePromptInline: vi.fn(),
  updatePromptValue: vi.fn(),
  showPromptInline: vi.fn(),
})

const readBlobText = async (blob: Blob) =>
  await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

const createCustomToolDoc = (initialValues: { schema: unknown; code: string }) => {
  const doc = new Y.Doc()
  seedEntitySession(doc, {
    entityKind: 'custom_tool',
    payload: {
      schemaText:
        typeof initialValues.schema === 'string'
          ? initialValues.schema
          : JSON.stringify(initialValues.schema, null, 2),
      codeText: initialValues.code,
    },
  })
  return doc
}

describe('CustomToolEditor', () => {
  let container: HTMLDivElement
  let root: Root
  let createObjectUrlSpy: ReturnType<typeof vi.fn>
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>
  let capturedDownloadName = ''

  beforeEach(() => {
    vi.clearAllMocks()
    editorMocks.cursorChange = null
    editorMocks.envVarOnSelect = null
    editorMocks.wandInputs.length = 0
    editorMocks.checkEnvVarTrigger.mockReturnValue({ show: false, searchTerm: '' })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    capturedDownloadName = ''

    mockUseWand.mockImplementation((input) => {
      editorMocks.wandInputs.push(input)
      return createWandState()
    })

    createObjectUrlSpy = vi.fn(() => 'blob:custom-tool-export')
    revokeObjectUrlSpy = vi.fn()

    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrlSpy,
    })
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrlSpy,
    })
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: function click() {
        capturedDownloadName = this.download
      },
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('exports the current schema and code buffer using the unified envelope', async () => {
    const onSectionChange = vi.fn()
    const initialValues = {
      schema: {
        type: 'function',
        function: {
          description: 'Fetch top moving symbols.',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
      code: 'return { movers: [] }',
    }
    const doc = createCustomToolDoc(initialValues)

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='schema'
          blockId='dashboard-custom-tool-editor'
          toolId='tool-1'
          toolTitle='Tool 1'
          onSectionChange={onSectionChange}
          panelId='panel-1'
          widgetKey='editor_custom_tool'
          doc={doc}
          save={vi.fn()}
        />
      )
    })

    await act(async () => {
      replaceEntityTextField(
        doc,
        'schemaText',
        JSON.stringify(
          {
            type: 'function',
            function: {
              description: 'Fetch top moving symbols.',
              parameters: {
                type: 'object',
                properties: {
                  session: {
                    type: 'string',
                  },
                },
                required: ['session'],
              },
            },
          },
          null,
          2
        )
      )
    })

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='code'
          blockId='dashboard-custom-tool-editor'
          toolId='tool-1'
          toolTitle='fetchTopMoversCurrent'
          onSectionChange={onSectionChange}
          panelId='panel-1'
          widgetKey='editor_custom_tool'
          doc={doc}
          save={vi.fn()}
        />
      )
    })

    await act(async () => {
      replaceEntityTextField(doc, 'codeText', 'return { exported: true }')
    })

    await act(async () => {
      emitEditorAction<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
        action: 'export',
        entityId: 'tool-1',
        panelId: 'panel-1',
        widgetKey: 'editor_custom_tool',
      })
    })

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:custom-tool-export')
    expect(capturedDownloadName).toBe('fetchTopMoversCurrent.json')

    const blob = createObjectUrlSpy.mock.calls[0]?.[0] as Blob
    const payload = JSON.parse(await readBlobText(blob))

    expect(payload).toEqual({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'customToolEditor',
      resourceTypes: ['customTools'],
      skills: [],
      workflows: [],
      customTools: [
        {
          title: 'fetchTopMoversCurrent',
          schema: {
            type: 'function',
            function: {
              description: 'Fetch top moving symbols.',
              parameters: {
                type: 'object',
                properties: {
                  session: {
                    type: 'string',
                  },
                },
                required: ['session'],
              },
            },
          },
          code: 'return { exported: true }',
        },
      ],
      watchlists: [],
      indicators: [],
    })
    doc.destroy()
  })

  it('blocks export when the current schema is invalid', async () => {
    const onSectionChange = vi.fn()
    const initialValues = {
      schema: {
        type: 'function',
        function: {
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
      code: 'return { movers: [] }',
    }
    const doc = createCustomToolDoc(initialValues)

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='schema'
          blockId='dashboard-custom-tool-editor'
          toolId='tool-1'
          toolTitle='Tool 1'
          onSectionChange={onSectionChange}
          panelId='panel-1'
          widgetKey='editor_custom_tool'
          doc={doc}
          save={vi.fn()}
        />
      )
    })

    await act(async () => {
      replaceEntityTextField(doc, 'schemaText', '{')
    })

    await act(async () => {
      emitEditorAction<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
        action: 'export',
        entityId: 'tool-1',
        panelId: 'panel-1',
        widgetKey: 'editor_custom_tool',
      })
    })

    expect(createObjectUrlSpy).not.toHaveBeenCalled()
    expect(onSectionChange).toHaveBeenCalledWith('schema')
    doc.destroy()
  })

  it('closes autocomplete and blocks its retained callback after becoming read-only', async () => {
    const doc = createCustomToolDoc({
      schema: {
        type: 'function',
        function: {
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
      },
      code: 'return 1',
    })
    const props = {
      activeSection: 'code' as const,
      blockId: 'dashboard-custom-tool-editor',
      toolId: 'tool-1',
      toolTitle: 'Tool 1',
      onSectionChange: vi.fn(),
      panelId: 'panel-1',
      widgetKey: 'editor_custom_tool',
      doc,
      save: vi.fn(),
    }
    editorMocks.checkEnvVarTrigger.mockReturnValue({ show: true, searchTerm: 'TOKEN' })

    await act(async () => {
      root.render(<CustomToolEditor {...props} />)
    })
    act(() => {
      editorMocks.cursorChange?.(8, { top: 0, left: 0, height: 16 })
    })
    expect(container.querySelector('[data-testid="env-var-dropdown"]')).not.toBeNull()
    const retainedOnSelect = editorMocks.envVarOnSelect
    const retainedStreamChunk = editorMocks.wandInputs[1]?.onStreamChunk

    await act(async () => {
      root.render(<CustomToolEditor {...props} readOnly={true} />)
    })
    expect(container.querySelector('[data-testid="env-var-dropdown"]')).toBeNull()

    act(() => {
      retainedOnSelect?.('return 2')
      retainedStreamChunk?.('return 3')
    })
    expect(getEntityFields(doc, 'custom_tool').codeText).toBe('return 1')
    doc.destroy()
  })
})
