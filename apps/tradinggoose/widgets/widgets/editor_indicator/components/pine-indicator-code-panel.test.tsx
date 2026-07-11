/**
 * @vitest-environment jsdom
 */

import type { MutableRefObject, ReactNode } from 'react'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import { IndicatorCodePanel } from './pine-indicator-code-panel'

const wandInputs = vi.hoisted(() => [] as Array<{ onStreamChunk?: (chunk: string) => void }>)

vi.mock('@/hooks/workflow/use-wand', () => ({
  useWand: (input: { onStreamChunk?: (chunk: string) => void }) => {
    wandInputs.push(input)
    return {
      isLoading: false,
      isStreaming: false,
      isPromptVisible: false,
      promptInputValue: '',
      generateStream: vi.fn(),
      cancelGeneration: vi.fn(),
      hidePromptInline: vi.fn(),
      updatePromptValue: vi.fn(),
      showPromptInline: vi.fn(),
    }
  },
}))

vi.mock('@/components/monaco-editor', () => ({
  buildMonacoIndicatorDiagnosticSource: vi.fn(),
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor',
  () => ({ CodeEditor: () => <div data-testid='indicator-code-editor' /> })
)

vi.mock('@/widgets/widgets/editor_workflow/components/wand-prompt-bar/wand-prompt-bar', () => ({
  WandPromptBar: () => null,
}))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
  EnvVarDropdown: () => null,
}))

vi.mock('@/components/ui/notice', () => ({
  Notice: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('IndicatorCodePanel access downgrade', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    wandInputs.length = 0
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('blocks a retained pre-downgrade stream callback from mutating Yjs', async () => {
    const doc = new Y.Doc()
    seedEntitySession(doc, {
      entityKind: 'indicator',
      payload: { color: '#ffffff', pineCode: 'plot(close)' },
    })
    const exportRef = createRef<() => void>()
    const saveRef = createRef<() => void>()
    const verifyRef = createRef<() => void>()
    const props = {
      indicatorId: 'indicator-1',
      indicatorName: 'Indicator',
      workspaceId: 'workspace-1',
      doc,
      save: vi.fn(async () => {}),
      exportRef: exportRef as MutableRefObject<() => void>,
      saveRef: saveRef as MutableRefObject<() => void>,
      verifyRef: verifyRef as MutableRefObject<() => void>,
    }

    await act(async () => root.render(<IndicatorCodePanel {...props} />))
    const retainedStreamChunk = wandInputs[0]?.onStreamChunk
    await act(async () => root.render(<IndicatorCodePanel {...props} readOnly={true} />))
    act(() => retainedStreamChunk?.('\nplot(open)'))

    expect(getEntityFields(doc, 'indicator').pineCode).toBe('plot(close)')
    doc.destroy()
  })
})
