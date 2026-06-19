/**
 * @vitest-environment jsdom
 */

import { act, useEffect, useRef, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../../../../i18n/messages/en.json'
import esMessages from '../../../../../../i18n/messages/es.json'
import { MENTION_SUBMENUS } from '../constants'
import type { MentionSources } from '../types'
import { useUserInputMentions } from './use-user-input-mentions'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

type MentionHookSnapshot = ReturnType<typeof useUserInputMentions> & {
  message: string
  textarea: HTMLTextAreaElement | null
}

const createMentionSources = (): MentionSources => ({
  pastChats: [],
  workspaceEntities: {
    workflow: [],
    skill: [],
    indicator: [],
    custom_tool: [],
    mcp_server: [],
  },
  knowledgeBases: [],
  blocksList: [],
  logsList: [],
  workflowBlocks: [],
})

function MentionsHarness({
  mentionSources,
  onRender,
  workspaceId,
  ensureSubmenuLoaded,
}: {
  mentionSources: MentionSources
  onRender: (value: MentionHookSnapshot) => void
  workspaceId: string
  ensureSubmenuLoaded: (submenu: any) => Promise<void>
}) {
  const [message, setMessage] = useState('')
  const menuListRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const result = useUserInputMentions({
    disabled: false,
    isLoading: false,
    menuListRef,
    message,
    mentionSources,
    setMessage,
    textareaRef,
    workspaceId,
    loaders: {
      ensureSubmenuLoaded,
    },
  })

  useEffect(() => {
    onRender({
      ...result,
      message,
      textarea: textareaRef.current,
    })
  }, [message, onRender, result])

  return (
    <>
      <textarea readOnly ref={textareaRef} value={message} />
      <div ref={menuListRef} />
    </>
  )
}

describe('useUserInputMentions', () => {
  let container: HTMLDivElement
  let root: Root
  let latestSnapshot: MentionHookSnapshot | null

  const ensureSubmenuLoaded = vi.fn(async () => {})

  const renderHarness = async ({
    locale,
    mentionSources,
    messages,
  }: {
    locale: 'en' | 'es'
    mentionSources: MentionSources
    messages: unknown
  }) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={messages as any}>
          <MentionsHarness
            ensureSubmenuLoaded={ensureSubmenuLoaded}
            mentionSources={mentionSources}
            onRender={(value) => {
              latestSnapshot = value
            }}
            workspaceId='workspace-1'
          />
        </NextIntlClientProvider>
      )
    })
  }

  const moveCaretToEnd = () => {
    const textarea = latestSnapshot?.textarea

    if (!textarea || !latestSnapshot) {
      throw new Error('Missing textarea for mention hook test.')
    }

    textarea.focus()
    textarea.setSelectionRange(latestSnapshot.message.length, latestSnapshot.message.length)
  }

  const createKeyEvent = (key: string) =>
    ({
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      preventDefault: vi.fn(),
      shiftKey: false,
    }) as any

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    latestSnapshot = null
    ensureSubmenuLoaded.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.unstubAllGlobals()
  })

  it('inserts the localized docs mention with keyboard selection', async () => {
    const docsLabel = (esMessages as any).nav.docs

    await renderHarness({
      locale: 'es',
      mentionSources: createMentionSources(),
      messages: esMessages,
    })

    await act(async () => {
      latestSnapshot?.handleInputChange('@doc', { end: 4, start: 4 })
    })

    moveCaretToEnd()

    await act(async () => {
      latestSnapshot?.handleKeyDown(createKeyEvent('Enter'))
    })

    expect(latestSnapshot?.message).toBe(`@${docsLabel} `)
    expect(latestSnapshot?.selectedContexts).toEqual([{ kind: 'docs', label: docsLabel }])
  })

  it('opens and confirms a custom tool submenu via keyboard using internal option ids', async () => {
    const mentionSources = createMentionSources()
    mentionSources.workspaceEntities.custom_tool = [
      {
        description: 'Send notifications to Slack',
        entityKind: 'custom_tool',
        functionName: 'sendSlackAlert',
        id: 'tool-1',
        name: 'Slack Alerts',
      },
    ]

    await renderHarness({
      locale: 'en',
      mentionSources,
      messages: enMessages,
    })

    await act(async () => {
      latestSnapshot?.handleInputChange('@tool', { end: 5, start: 5 })
    })

    moveCaretToEnd()

    await act(async () => {
      latestSnapshot?.handleKeyDown(createKeyEvent('Enter'))
    })

    expect(latestSnapshot?.openSubmenuFor).toBe('custom_tool')
    expect(latestSnapshot?.message).toBe('@')

    moveCaretToEnd()

    await act(async () => {
      latestSnapshot?.handleKeyDown(createKeyEvent('Enter'))
    })

    expect(latestSnapshot?.message).toBe('@Slack Alerts ')
    expect(latestSnapshot?.openSubmenuFor).toBeNull()
    expect(latestSnapshot?.selectedContexts).toEqual([
      {
        customToolId: 'tool-1',
        kind: 'custom_tool',
        label: 'Slack Alerts',
        workspaceId: 'workspace-1',
      },
    ])
  })

  it('reloads mention submenu sources when the locale changes with the root menu still open', async () => {
    await renderHarness({
      locale: 'en',
      mentionSources: createMentionSources(),
      messages: enMessages,
    })

    await act(async () => {
      latestSnapshot?.handleInputChange('@blo', { end: 4, start: 4 })
    })

    moveCaretToEnd()
    ensureSubmenuLoaded.mockClear()

    await renderHarness({
      locale: 'es',
      mentionSources: createMentionSources(),
      messages: esMessages,
    })

    expect(latestSnapshot?.showMentionMenu).toBe(true)
    expect(latestSnapshot?.openSubmenuFor).toBeNull()
    expect(ensureSubmenuLoaded.mock.calls.map((call) => call.at(0))).toEqual(MENTION_SUBMENUS)
  })

  it('reloads the open blocks submenu when the locale changes without closing the menu', async () => {
    await renderHarness({
      locale: 'en',
      mentionSources: createMentionSources(),
      messages: enMessages,
    })

    await act(async () => {
      latestSnapshot?.handleInputChange('@blo', { end: 4, start: 4 })
    })

    moveCaretToEnd()

    await act(async () => {
      latestSnapshot?.handleMainMentionOptionSelect('blocks')
    })

    expect(latestSnapshot?.openSubmenuFor).toBe('blocks')

    ensureSubmenuLoaded.mockClear()

    await renderHarness({
      locale: 'es',
      mentionSources: createMentionSources(),
      messages: esMessages,
    })

    expect(latestSnapshot?.openSubmenuFor).toBe('blocks')
    expect(ensureSubmenuLoaded).toHaveBeenCalledTimes(1)
    expect(ensureSubmenuLoaded).toHaveBeenCalledWith('blocks')
  })
})
