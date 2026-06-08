/**
 * @vitest-environment jsdom
 */

import type { MutableRefObject, ReactNode, TextareaHTMLAttributes } from 'react'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomToolEditor } from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'

const mockUseUpdateCustomTool = vi.fn()
const mockUseWand = vi.fn()

vi.mock('@/hooks/queries/custom-tools', async () => {
  const actual = await vi.importActual<any>('@/hooks/queries/custom-tools')
  return {
    ...actual,
    useUpdateCustomTool: () => mockUseUpdateCustomTool(),
  }
})

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

    mockUseUpdateCustomTool.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    })
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
          name: 'fetchTopMovers',
          description: 'Fetch top moving symbols.',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
      code: 'return { movers: [] }',
    }

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='schema'
          blockId='dashboard-custom-tool-editor'
          initialValues={initialValues}
          onSave={vi.fn()}
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
        />
      )
    })

    const schemaEditor = container.querySelector(
      '[data-testid="code-editor-json"]'
    ) as HTMLTextAreaElement | null
    expect(schemaEditor).toBeTruthy()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set
      valueSetter?.call(
        schemaEditor,
        JSON.stringify(
          {
            type: 'function',
            function: {
              name: 'fetchTopMoversCurrent',
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
      schemaEditor!.dispatchEvent(new Event('input', { bubbles: true }))
      schemaEditor!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='code'
          blockId='dashboard-custom-tool-editor'
          initialValues={initialValues}
          onSave={vi.fn()}
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
        />
      )
    })

    const codeEditor = container.querySelector(
      '[data-testid="code-editor-javascript"]'
    ) as HTMLTextAreaElement | null
    expect(codeEditor).toBeTruthy()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set
      valueSetter?.call(codeEditor, 'return { exported: true }')
      codeEditor!.dispatchEvent(new Event('input', { bubbles: true }))
      codeEditor!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      exportRef.current?.()
    })

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:custom-tool-export')
    expect(capturedDownloadName).toBe('Fetch-Top-Movers.json')

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
          title: 'Fetch Top Movers',
          schema: {
            type: 'function',
            function: {
              name: 'fetchTopMoversCurrent',
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
          name: 'fetchTopMovers',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
      code: 'return { movers: [] }',
    }

    await act(async () => {
      root.render(
        <CustomToolEditor
          activeSection='schema'
          blockId='dashboard-custom-tool-editor'
          initialValues={initialValues}
          onSave={vi.fn()}
          onSectionChange={onSectionChange}
          exportRef={exportRef as MutableRefObject<() => void>}
          saveRef={saveRef as MutableRefObject<() => void>}
        />
      )
    })

    const schemaEditor = container.querySelector(
      '[data-testid="code-editor-json"]'
    ) as HTMLTextAreaElement | null
    expect(schemaEditor).toBeTruthy()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )?.set
      valueSetter?.call(schemaEditor, '{')
      schemaEditor!.dispatchEvent(new Event('input', { bubbles: true }))
      schemaEditor!.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () => {
      exportRef.current?.()
    })

    expect(createObjectUrlSpy).not.toHaveBeenCalled()
    expect(onSectionChange).toHaveBeenCalledWith('schema')
  })
})
