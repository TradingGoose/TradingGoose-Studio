/**
 * @vitest-environment jsdom
 */

import { act, useEffect } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
} from '@/i18n/workflow-inspector-core'
import esMessages from '../../../../../../i18n/messages/es.json'
import zhMessages from '../../../../../../i18n/messages/zh.json'
import { useUserInputMentionSources } from './use-user-input-mention-sources'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockBlocks = [
  {
    type: 'condition',
    name: 'Condition',
    category: 'blocks',
    hideFromToolbar: false,
    bgColor: '#3972F6',
  },
]
const mockWorkflowBlocks: Record<string, any> = {}
let mockWorkflowId: string | null = null

const mockGetAllBlocks = vi.fn(() => mockBlocks)
const mockGetBlock = vi.fn((blockType: string) =>
  mockBlocks.find((block) => block.type === blockType)
)
const mockFetch = vi.fn(async (input: string | URL | Request) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  if (url.startsWith('/api/workflows?')) {
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'workflow-1',
            name: 'Workflow One',
            color: '#3972F6',
          },
        ],
      }),
    } as any
  }

  throw new Error(`Unexpected fetch in mention sources test: ${url}`)
})

vi.mock('@/blocks', () => ({
  getAllBlocks: () => mockGetAllBlocks(),
  getBlock: (blockType: string) => mockGetBlock(blockType),
}))

vi.mock('@/blocks/registry', () => ({
  registry: {
    condition: {
      bgColor: '#3972F6',
      icon: null,
      name: 'Condition',
    },
  },
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowBlocks: () => mockWorkflowBlocks,
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useOptionalWorkflowSession: () =>
    mockWorkflowId
      ? {
          workflowId: mockWorkflowId,
        }
      : null,
}))

type MentionSourcesHookResult = ReturnType<typeof useUserInputMentionSources>

function MentionSourcesHarness({
  onRender,
  workspaceId,
}: {
  onRender: (value: MentionSourcesHookResult) => void
  workspaceId: string
}) {
  const result = useUserInputMentionSources({ workspaceId })

  useEffect(() => {
    onRender(result)
  }, [onRender, result])

  return null
}

describe('useUserInputMentionSources', () => {
  let container: HTMLDivElement
  let root: Root
  let latestResult: MentionSourcesHookResult | null

  const renderHarness = async ({
    locale,
    messages,
  }: {
    locale: 'es' | 'zh'
    messages: unknown
  }) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={messages as any}>
          <MentionSourcesHarness
            workspaceId='workspace-1'
            onRender={(value) => {
              latestResult = value
            }}
          />
        </NextIntlClientProvider>
      )
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('fetch', mockFetch)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    latestResult = null
    mockWorkflowId = null
    for (const key of Object.keys(mockWorkflowBlocks)) {
      delete mockWorkflowBlocks[key]
    }
    mockGetAllBlocks.mockClear()
    mockGetBlock.mockClear()
    mockFetch.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.unstubAllGlobals()
  })

  it('reloads localized block mention labels after a locale change', async () => {
    const spanishBlockName = getLocalizedBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      mockBlocks[0]
    )
    const chineseBlockName = getLocalizedBlockNameWithCopy(
      (zhMessages as any).workspace.widgets,
      mockBlocks[0]
    )

    await renderHarness({
      locale: 'es',
      messages: esMessages,
    })

    await act(async () => {
      await latestResult?.ensureBlocksLoaded()
    })

    expect(latestResult?.blocksList.map((item) => item.name)).toEqual([spanishBlockName])

    await renderHarness({
      locale: 'zh',
      messages: zhMessages,
    })

    expect(latestResult?.blocksList).toEqual([])

    await act(async () => {
      await latestResult?.ensureBlocksLoaded()
    })

    expect(latestResult?.blocksList.map((item) => item.name)).toEqual([chineseBlockName])
    expect(mockGetAllBlocks).toHaveBeenCalledTimes(2)
  })

  it('reloads localized workflow block mention labels after a locale change', async () => {
    mockWorkflowId = 'workflow-1'
    mockWorkflowBlocks['workflow-block-1'] = {
      id: 'workflow-block-1',
      type: 'condition',
      name: 'Condition 2',
    }

    const spanishWorkflowBlockName = getLocalizedDefaultBlockNameWithCopy(
      (esMessages as any).workspace.widgets,
      'condition',
      'Condition 2'
    )
    const chineseWorkflowBlockName = getLocalizedDefaultBlockNameWithCopy(
      (zhMessages as any).workspace.widgets,
      'condition',
      'Condition 2'
    )

    await renderHarness({
      locale: 'es',
      messages: esMessages,
    })

    await act(async () => {
      await latestResult?.ensureWorkflowBlocksLoaded()
    })

    expect(latestResult?.workflowBlocks.map((item) => item.name)).toEqual([
      spanishWorkflowBlockName,
    ])

    await renderHarness({
      locale: 'zh',
      messages: zhMessages,
    })

    await act(async () => {
      await latestResult?.ensureWorkflowBlocksLoaded()
    })

    expect(latestResult?.workflowBlocks.map((item) => item.name)).toEqual([
      chineseWorkflowBlockName,
    ])
  })
})
