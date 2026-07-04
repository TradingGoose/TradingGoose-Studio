/**
 * @vitest-environment jsdom
 */

import type { MutableRefObject, ReactNode, TextareaHTMLAttributes } from 'react'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { replaceEntityTextField, seedEntitySession, setEntityField } from '@/lib/yjs/entity-session'
import { CustomToolEditor } from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'

const mockUseWand = vi.fn()

vi.mock('@/hooks/workflow/use-wand', () => ({
  useWand: (...args: unknown[]) => mockUseWand(...args),
}))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
  EnvVarDropdown: () => null,
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  checkTagTrigger: () => ({ show: false }),
  TagDropdown: () => null,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
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
    }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
      value?: string
      onChange?: (value: string) => void
      language?: string
    }) => (
      <textarea
        data-testid={`code-editor-${language}`}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      />
    ),
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

const createCustomToolDoc = (initialValues: { title: string; schema: unknown; code: string }) => {
  const doc = new Y.Doc()
  seedEntitySession(doc, {
    entityKind: 'custom_tool',
    payload: {
      title: initialValues.title,
      schemaText:
        typeof initialValues.schema === 'string'
          ? initialValues.schema
          : JSON.stringify(initialValues.schema, null, 2),
      codeText: initialValues.code,
    },
  })
  return doc
}

describe('CustomToolEditor export', () => {
  let container: HTMLDivElement
  let root: Root
  let createObjectUrlSpy: ReturnType<typeof vi.fn>
  let revokeObjectUrlSpy: ReturnType<typeof vi.fn>
  let capturedDownloadName = ''

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    capturedDownloadName = ''

    mockUseWand.mockImplementation(() => createWandState())

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
    const exportRef = createRef<() => void>()
    const saveRef = createRef<() => void>()
    exportRef.current = () => {}
    saveRef.current = () => {}
    const onSectionChange = vi.fn()
    const initialValues = {
      id: 'tool-1',
      title: 'Fetch Top Movers',
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
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
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
      setEntityField(doc, 'title', 'fetchTopMoversCurrent')
    })

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='code'
          blockId='dashboard-custom-tool-editor'
          toolId='tool-1'
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
          doc={doc}
          save={vi.fn()}
        />
      )
    })

    await act(async () => {
      replaceEntityTextField(doc, 'codeText', 'return { exported: true }')
    })

    await act(async () => {
      exportRef.current?.()
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
    const exportRef = createRef<() => void>()
    const saveRef = createRef<() => void>()
    exportRef.current = () => {}
    saveRef.current = () => {}
    const onSectionChange = vi.fn()
    const initialValues = {
      id: 'tool-1',
      title: 'Fetch Top Movers',
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
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
          doc={doc}
          save={vi.fn()}
        />
      )
    })

    await act(async () => {
      replaceEntityTextField(doc, 'schemaText', '{')
    })

    await act(async () => {
      exportRef.current?.()
    })

    expect(createObjectUrlSpy).not.toHaveBeenCalled()
    expect(onSectionChange).toHaveBeenCalledWith('schema')
    doc.destroy()
  })
})
