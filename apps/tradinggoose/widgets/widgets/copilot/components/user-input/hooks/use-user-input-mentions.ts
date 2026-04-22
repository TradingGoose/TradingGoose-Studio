'use client'

import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import type { ChatContext } from '@/stores/copilot/types'
import {
  buildCopilotWorkspaceEntityContext,
  isCopilotWorkspaceEntityMentionOption,
  matchesCopilotWorkspaceEntityContext,
} from '../../../workspace-entities'
import { MENTION_SUBMENUS } from '../constants'
import {
  buildAggregatedMentionItems,
  filterBlocks,
  filterKnowledgeBases,
  filterLogs,
  filterMentionOptions,
  filterPastChats,
  filterWorkflowBlocks,
  filterWorkspaceEntitiesForOption,
} from '../mention-utils'
import type {
  AggregatedMentionItem,
  MentionItem,
  MentionOption,
  MentionRange,
  MentionSources,
  MentionSubmenu,
  WorkspaceEntityItem,
} from '../types'

interface UseUserInputMentionsOptions {
  disabled: boolean
  isLoading: boolean
  menuListRef: RefObject<HTMLDivElement | null>
  message: string
  mentionSources: MentionSources
  setMessage: (value: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  workspaceId: string
  loaders: {
    ensureSubmenuLoaded: (submenu: MentionSubmenu) => Promise<void>
  }
}

export function useUserInputMentions({
  disabled,
  isLoading,
  menuListRef,
  message,
  mentionSources,
  setMessage,
  textareaRef,
  workspaceId,
  loaders,
}: UseUserInputMentionsOptions) {
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [openSubmenuFor, setOpenSubmenuFor] = useState<MentionSubmenu | null>(null)
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
  const [submenuQueryStart, setSubmenuQueryStart] = useState<number | null>(null)
  const [inAggregated, setInAggregated] = useState(false)
  const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>([])
  const workflowSession = useOptionalWorkflowSession()
  const currentWorkflowId = workflowSession?.workflowId ?? null
  const lastSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const getEditorTextLength = () => textareaRef.current?.value.length ?? message.length

  const normalizeSelection = (selection: { start: number; end: number }) => {
    const max = getEditorTextLength()
    const start = Math.max(0, Math.min(selection.start, max))
    const end = Math.max(start, Math.min(selection.end, max))
    return { start, end }
  }

  const getSelection = () => {
    const textarea = textareaRef.current

    if (textarea) {
      const start = textarea.selectionStart ?? getEditorTextLength()
      const normalized = normalizeSelection({
        start,
        end: textarea.selectionEnd ?? start,
      })
      lastSelectionRef.current = normalized
      return normalized
    }

    return normalizeSelection(lastSelectionRef.current)
  }

  const focusEditor = () => {
    textareaRef.current?.focus()
  }

  const setEditorSelection = (start: number, end: number = start) => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const normalized = normalizeSelection({ start, end })
    lastSelectionRef.current = normalized
    textarea.setSelectionRange(normalized.start, normalized.end)
  }

  const restoreEditorSelection = (start: number, end: number = start) => {
    requestAnimationFrame(() => {
      focusEditor()
      setEditorSelection(start, end)
    })
  }

  const getCaretPos = () => getSelection()?.start ?? message.length

  const scrollActiveItemIntoView = (index: number) => {
    const container = menuListRef.current
    if (!container) return

    const item = container.querySelector(`[data-idx="${index}"]`) as HTMLElement | null
    if (!item) return

    const tolerance = 8
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const needsScrollUp = itemTop < viewTop + tolerance
    const needsScrollDown = itemBottom > viewBottom - tolerance

    if (needsScrollUp || needsScrollDown) {
      if (needsScrollUp) {
        container.scrollTop = Math.max(0, itemTop - tolerance)
      } else {
        container.scrollTop = itemBottom + tolerance - container.clientHeight
      }
    }
  }

  const computeMentionRanges = (text: string = message) => {
    const ranges: MentionRange[] = []

    if (!text || selectedContexts.length === 0) {
      return ranges
    }

    const labels = Array.from(
      new Set(selectedContexts.map((context) => context.label).filter(Boolean) as string[])
    )

    if (labels.length === 0) {
      return ranges
    }

    for (const label of labels) {
      const token = `@${label}`
      let fromIndex = 0

      while (fromIndex <= text.length) {
        const index = text.indexOf(token, fromIndex)

        if (index === -1) {
          break
        }

        const beforeChar = index === 0 ? ' ' : text[index - 1]
        const afterChar = text[index + token.length] ?? ''
        const hasLeadingBoundary = index === 0 || /\s/.test(beforeChar)
        const hasTrailingBoundary = index + token.length >= text.length || /\s/.test(afterChar)

        if (hasLeadingBoundary && hasTrailingBoundary) {
          ranges.push({ start: index, end: index + token.length, label })
        }

        fromIndex = index + token.length
      }
    }

    ranges.sort((a, b) => a.start - b.start)
    return ranges
  }

  const mentionRanges = computeMentionRanges()

  const findRangeContaining = (pos: number) => {
    return computeMentionRanges().find((range) => pos > range.start && pos < range.end)
  }

  const findRangeOverlappingSelection = (start: number, end: number) => {
    return computeMentionRanges().find((range) => start < range.end && end > range.start)
  }

  const getActiveMentionQueryAtPosition = (pos: number, textOverride?: string) => {
    const text = textOverride ?? message
    const before = text.slice(0, pos)
    const atIndex = before.lastIndexOf('@')

    if (atIndex === -1) {
      return null
    }

    if (atIndex > 0 && !/\s/.test(before.charAt(atIndex - 1))) {
      return null
    }

    const ranges = computeMentionRanges(text)
    if (ranges.some((range) => atIndex > range.start && atIndex < range.end)) {
      return null
    }

    const segment = before.slice(atIndex + 1)
    if (/\s/.test(segment)) {
      return null
    }

    return { query: segment, start: atIndex, end: pos }
  }

  const getMentionQuery = () =>
    (getActiveMentionQueryAtPosition(getCaretPos())?.query || '').trim().toLowerCase()

  const mentionQuery = showMentionMenu ? getMentionQuery() : ''
  const submenuQuery =
    openSubmenuFor && submenuQueryStart != null
      ? message.slice(submenuQueryStart, getCaretPos()).toLowerCase()
      : ''
  const aggregatedActive =
    showMentionMenu &&
    !openSubmenuFor &&
    mentionQuery.length > 0 &&
    filterMentionOptions(mentionQuery).length === 0

  const closeMentionMenu = () => {
    setShowMentionMenu(false)
    setOpenSubmenuFor(null)
    setSubmenuQueryStart(null)
    setMentionActiveIndex(0)
    setSubmenuActiveIndex(0)
    setInAggregated(false)
  }

  const clearSelectedContexts = () => {
    setSelectedContexts([])
  }

  const getFilteredSubmenuItems = (submenu: MentionSubmenu, query: string): MentionItem[] => {
    if (submenu === 'Chats') {
      return filterPastChats(mentionSources.pastChats, query)
    }

    if (isCopilotWorkspaceEntityMentionOption(submenu)) {
      return filterWorkspaceEntitiesForOption(submenu, mentionSources, query)
    }

    if (submenu === 'Knowledge') {
      return filterKnowledgeBases(mentionSources.knowledgeBases, query)
    }

    if (submenu === 'Blocks') {
      return filterBlocks(mentionSources.blocksList, query)
    }

    if (submenu === 'Workflow Blocks') {
      return filterWorkflowBlocks(mentionSources.workflowBlocks, query)
    }

    return filterLogs(mentionSources.logsList, query)
  }

  const insertAtCursor = (text: string) => {
    const selection = getSelection()
    const start = selection?.start ?? message.length
    const end = selection?.end ?? message.length
    let before = message.slice(0, start)
    const after = message.slice(end)

    if (before.endsWith('@') && text.startsWith('@')) {
      before = before.slice(0, -1)
    }

    const next = `${before}${text}${after}`
    setMessage(next)

    const nextPos = before.length + text.length
    restoreEditorSelection(nextPos, nextPos)
  }

  const replaceActiveMentionWith = (label: string) => {
    if (!textareaRef.current) return false

    const pos = getSelection()?.start ?? message.length
    const active = getActiveMentionQueryAtPosition(pos)

    if (!active) {
      return false
    }

    const before = message.slice(0, active.start)
    const after = message.slice(active.end)
    const trailingSpace = after.length > 0 && /^\s/.test(after) ? '' : ' '
    const insertion = `@${label}${trailingSpace}`
    const next = `${before}${insertion}${after}`

    setMessage(next)

    const cursorPos = before.length + insertion.length
    restoreEditorSelection(cursorPos, cursorPos)

    return true
  }

  const resetActiveMentionQuery = () => {
    if (!textareaRef.current) return

    const pos = getSelection()?.start ?? message.length
    const active = getActiveMentionQueryAtPosition(pos)

    if (!active) {
      return
    }

    const before = message.slice(0, active.start + 1)
    const after = message.slice(active.end)
    const next = `${before}${after}`
    setMessage(next)

    const caretPos = before.length
    restoreEditorSelection(caretPos, caretPos)
  }

  const insertPastChatMention = (chat: { reviewSessionId: string; title: string | null }) => {
    const label = chat.title || 'Untitled Chat'
    replaceActiveMentionWith(label)
    setSelectedContexts((prev) => {
      if (
        prev.some(
          (context) =>
            context.kind === 'past_chat' &&
            (context as any).reviewSessionId === chat.reviewSessionId
        )
      ) {
        return prev
      }

      return [
        ...prev,
        { kind: 'past_chat', reviewSessionId: chat.reviewSessionId, label } as ChatContext,
      ]
    })
    closeMentionMenu()
  }

  const insertWorkspaceEntityMention = (item: WorkspaceEntityItem) => {
    const label = item.name || 'Untitled'
    const token = `@${label}`

    if (!replaceActiveMentionWith(label)) {
      insertAtCursor(`${token} `)
    }

    setSelectedContexts((prev) => {
      if (
        prev.some((context) =>
          matchesCopilotWorkspaceEntityContext(context, item.entityKind, item.id)
        )
      ) {
        return prev
      }

      return [
        ...prev,
        buildCopilotWorkspaceEntityContext({
          entityKind: item.entityKind,
          entityId: item.id,
          workspaceId,
          label,
        }),
      ]
    })
    closeMentionMenu()
  }

  const insertKnowledgeMention = (knowledgeBase: { id: string; name: string }) => {
    const label = knowledgeBase.name || 'Untitled'
    replaceActiveMentionWith(label)
    setSelectedContexts((prev) => {
      if (
        prev.some(
          (context) =>
            context.kind === 'knowledge' && (context as any).knowledgeId === knowledgeBase.id
        )
      ) {
        return prev
      }

      return [...prev, { kind: 'knowledge', knowledgeId: knowledgeBase.id, label } as any]
    })
    closeMentionMenu()
  }

  const insertBlockMention = (block: { id: string; name: string }) => {
    const label = block.name || block.id
    replaceActiveMentionWith(label)
    setSelectedContexts((prev) => {
      if (
        prev.some((context) => context.kind === 'blocks' && context.blockIds.includes(block.id))
      ) {
        return prev
      }

      return [...prev, { kind: 'blocks', blockIds: [block.id], label } as ChatContext]
    })
    closeMentionMenu()
  }

  const insertWorkflowBlockMention = (block: { id: string; name: string }) => {
    if (!currentWorkflowId) {
      closeMentionMenu()
      return
    }

    const label = block.name
    const token = `@${label}`

    if (!replaceActiveMentionWith(label)) {
      insertAtCursor(`${token} `)
    }

    setSelectedContexts((prev) => {
      if (
        prev.some(
          (context) =>
            context.kind === 'workflow_block' &&
            (context as any).workflowId === currentWorkflowId &&
            (context as any).blockId === block.id
        )
      ) {
        return prev
      }

      return [
        ...prev,
        {
          kind: 'workflow_block',
          workflowId: currentWorkflowId,
          blockId: block.id,
          label,
        } as any,
      ]
    })
    closeMentionMenu()
  }

  const insertDocsMention = () => {
    const label = 'Docs'
    if (!replaceActiveMentionWith(label)) {
      insertAtCursor(`@${label} `)
    }

    setSelectedContexts((prev) => {
      if (prev.some((context) => context.kind === 'docs')) {
        return prev
      }

      return [...prev, { kind: 'docs', label } as any]
    })
    closeMentionMenu()
  }

  const insertLogMention = (log: {
    id: string
    executionId?: string
    level: string
    trigger: string | null
    createdAt: string
    workflowName: string
  }) => {
    const label = log.workflowName
    replaceActiveMentionWith(label)
    setSelectedContexts((prev) => {
      if (prev.some((context) => context.kind === 'logs' && context.label === label)) {
        return prev
      }

      return [...prev, { kind: 'logs', executionId: log.executionId, label }]
    })
    closeMentionMenu()
  }

  const handleSubmenuItemSelect = (submenu: MentionSubmenu, item: MentionItem) => {
    if (submenu === 'Chats') {
      insertPastChatMention(item as any)
    } else if (isCopilotWorkspaceEntityMentionOption(submenu)) {
      insertWorkspaceEntityMention(item as WorkspaceEntityItem)
    } else if (submenu === 'Knowledge') {
      insertKnowledgeMention(item as any)
    } else if (submenu === 'Blocks') {
      insertBlockMention(item as any)
    } else if (submenu === 'Workflow Blocks') {
      insertWorkflowBlockMention(item as any)
    } else if (submenu === 'Logs') {
      insertLogMention(item as any)
    }

    setSubmenuQueryStart(null)
  }

  const handleAggregatedItemSelect = (item: AggregatedMentionItem) => {
    if (item.type === 'Chats') {
      insertPastChatMention(item.value as any)
    } else if (isCopilotWorkspaceEntityMentionOption(item.type)) {
      insertWorkspaceEntityMention(item.value as WorkspaceEntityItem)
    } else if (item.type === 'Knowledge') {
      insertKnowledgeMention(item.value as any)
    } else if (item.type === 'Blocks') {
      insertBlockMention(item.value as any)
    } else if (item.type === 'Workflow Blocks') {
      insertWorkflowBlockMention(item.value as any)
    } else if (item.type === 'Logs') {
      insertLogMention(item.value as any)
    }
  }

  const openMentionSubmenu = (submenu: MentionSubmenu) => {
    resetActiveMentionQuery()
    setOpenSubmenuFor(submenu)
    setSubmenuActiveIndex(0)
    setSubmenuQueryStart(getCaretPos())
    void loaders.ensureSubmenuLoaded(submenu)
  }

  const handleMainMentionOptionSelect = (option: MentionOption) => {
    if (option === 'Docs') {
      resetActiveMentionQuery()
      insertDocsMention()
      return
    }

    openMentionSubmenu(option)
  }

  const deleteRange = (range: MentionRange) => {
    const before = message.slice(0, range.start)
    const after = message.slice(range.end)
    const next =
      before.endsWith(' ') && after.startsWith(' ')
        ? `${before}${after.slice(1)}`
        : `${before}${after}`
    setMessage(next)
    setSelectedContexts((prev) => prev.filter((context) => context.label !== range.label))

    restoreEditorSelection(range.start, range.start)
  }

  const handleInputChange = (
    newValue: string,
    selection: { start: number; end: number } = { start: newValue.length, end: newValue.length }
  ) => {
    setMessage(newValue)
    const normalizedSelection = {
      start: Math.max(0, Math.min(selection.start, newValue.length)),
      end: Math.max(0, Math.min(selection.end, newValue.length)),
    }
    lastSelectionRef.current = normalizedSelection

    const active = getActiveMentionQueryAtPosition(normalizedSelection.start, newValue)

    if (active) {
      void loaders.ensureSubmenuLoaded('Workflow Blocks')
      setShowMentionMenu(true)
      setInAggregated(false)

      if (openSubmenuFor) {
        setSubmenuActiveIndex(0)
        requestAnimationFrame(() => scrollActiveItemIntoView(0))
      } else {
        setMentionActiveIndex(0)
        setSubmenuActiveIndex(0)
        requestAnimationFrame(() => scrollActiveItemIntoView(0))
      }
      return
    }

    closeMentionMenu()
  }

  const handleSelectAdjust = () => {
    const selection = getSelection()
    const pos = selection?.start ?? 0
    const range =
      selection && selection.start !== selection.end
        ? findRangeOverlappingSelection(selection.start, selection.end)
        : findRangeContaining(pos)

    if (range) {
      const snapPos =
        selection && selection.start !== selection.end
          ? range.end
          : pos - range.start < range.end - pos
            ? range.start
            : range.end
      requestAnimationFrame(() => {
        setEditorSelection(snapPos, snapPos)
      })
    }
  }

  const handleOpenMentionMenuWithAt = () => {
    if (disabled || isLoading) {
      return
    }

    if (!textareaRef.current) return

    focusEditor()
    const pos = getSelection()?.start ?? message.length
    const needsSpaceBefore = pos > 0 && !/\s/.test(message.charAt(pos - 1))
    insertAtCursor(needsSpaceBefore ? ' @' : '@')
    void loaders.ensureSubmenuLoaded('Workflow Blocks')
    setShowMentionMenu(true)
    setOpenSubmenuFor(null)
    setMentionActiveIndex(0)
    setSubmenuActiveIndex(0)
    setInAggregated(false)
    requestAnimationFrame(() => scrollActiveItemIntoView(0))
  }

  const insertTextAtSelection = (text: string) => {
    insertAtCursor(text)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const selection = getSelection()
    const selectionStart = selection?.start ?? 0
    const selectionEnd = selection?.end ?? selectionStart
    const selectionLength = Math.abs(selectionEnd - selectionStart)

    if (event.key === 'Escape' && showMentionMenu) {
      event.preventDefault()

      if (openSubmenuFor) {
        setOpenSubmenuFor(null)
        setSubmenuQueryStart(null)
      } else {
        closeMentionMenu()
      }

      return true
    }

    if (showMentionMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()

      const moveIndex = (currentIndex: number, itemCount: number) => {
        if (itemCount === 0) {
          return 0
        }

        if (event.key === 'ArrowDown') {
          return currentIndex >= itemCount - 1 ? 0 : currentIndex + 1
        }

        return currentIndex <= 0 ? itemCount - 1 : currentIndex - 1
      }

      const filteredMain = openSubmenuFor ? [] : filterMentionOptions(mentionQuery)
      const aggregatedItems =
        !openSubmenuFor && mentionQuery.length > 0
          ? buildAggregatedMentionItems(mentionQuery, mentionSources)
          : []

      if (openSubmenuFor) {
        const items = getFilteredSubmenuItems(openSubmenuFor, submenuQuery)
        setSubmenuActiveIndex((prev) => {
          const next = moveIndex(prev, items.length)
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
        return true
      }

      if (aggregatedActive) {
        setInAggregated(true)
        setSubmenuActiveIndex((prev) => {
          const next = moveIndex(prev, aggregatedItems.length)
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
        return true
      }

      if (!inAggregated) {
        const lastMainIndex = Math.max(0, filteredMain.length - 1)

        if (filteredMain.length === 0) {
          if (aggregatedItems.length > 0) {
            setInAggregated(true)
            setSubmenuActiveIndex(0)
            requestAnimationFrame(() => scrollActiveItemIntoView(0))
          }
          return true
        }

        if (event.key === 'ArrowDown' && mentionActiveIndex >= lastMainIndex) {
          if (aggregatedItems.length > 0) {
            setInAggregated(true)
            setSubmenuActiveIndex(0)
            requestAnimationFrame(() => scrollActiveItemIntoView(0))
          } else {
            setMentionActiveIndex(0)
            requestAnimationFrame(() => scrollActiveItemIntoView(0))
          }
          return true
        }

        if (event.key === 'ArrowUp' && mentionActiveIndex <= 0 && aggregatedItems.length > 0) {
          const nextIndex = Math.max(0, aggregatedItems.length - 1)
          setInAggregated(true)
          setSubmenuActiveIndex(nextIndex)
          requestAnimationFrame(() => scrollActiveItemIntoView(nextIndex))
          return true
        }

        setMentionActiveIndex((prev) => {
          const next =
            event.key === 'ArrowDown' ? Math.min(prev + 1, lastMainIndex) : Math.max(prev - 1, 0)
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        })
        return true
      }

      setSubmenuActiveIndex((prev) => {
        const lastIndex = Math.max(0, aggregatedItems.length - 1)

        if (aggregatedItems.length === 0) {
          return 0
        }

        if (event.key === 'ArrowDown') {
          if (prev >= lastIndex) {
            setInAggregated(false)
            requestAnimationFrame(() => scrollActiveItemIntoView(0))
            return prev
          }

          const next = prev + 1
          requestAnimationFrame(() => scrollActiveItemIntoView(next))
          return next
        }

        if (prev <= 0) {
          const nextMainIndex = Math.max(0, filteredMain.length - 1)
          setInAggregated(false)
          setMentionActiveIndex(nextMainIndex)
          requestAnimationFrame(() => scrollActiveItemIntoView(nextMainIndex))
          return prev
        }

        const next = prev - 1
        requestAnimationFrame(() => scrollActiveItemIntoView(next))
        return next
      })

      return true
    }

    if (showMentionMenu && event.key === 'ArrowRight') {
      event.preventDefault()

      if (inAggregated) {
        return true
      }

      const selected = filterMentionOptions(mentionQuery)[mentionActiveIndex]
      if (selected) {
        handleMainMentionOptionSelect(selected)
      }
      return true
    }

    if (showMentionMenu && event.key === 'ArrowLeft') {
      if (openSubmenuFor) {
        event.preventDefault()
        setOpenSubmenuFor(null)
        setSubmenuQueryStart(null)
        return true
      }

      if (inAggregated) {
        event.preventDefault()
        setInAggregated(false)
        return true
      }
    }

    if (!showMentionMenu && event.key === 'Backspace') {
      const target =
        selectionLength > 0
          ? computeMentionRanges().find(
              (range) => !(selectionEnd <= range.start || selectionStart >= range.end)
            )
          : computeMentionRanges().find(
              (range) => selectionStart > range.start && selectionStart <= range.end
            )

      if (target) {
        event.preventDefault()
        deleteRange(target)
        return true
      }
    }

    if (!showMentionMenu && event.key === 'Delete') {
      const target = computeMentionRanges().find(
        (range) => selectionStart >= range.start && selectionStart < range.end
      )

      if (target) {
        event.preventDefault()
        deleteRange(target)
        return true
      }
    }

    if (
      !showMentionMenu &&
      selectionLength === 0 &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      if (event.key === 'ArrowLeft') {
        const nextPos = Math.max(0, selectionStart - 1)
        const range = findRangeContaining(nextPos)

        if (range) {
          event.preventDefault()
          requestAnimationFrame(() => setEditorSelection(range.start, range.start))
          return true
        }
      } else if (event.key === 'ArrowRight') {
        const nextPos = Math.min(message.length, selectionStart + 1)
        const range = findRangeContaining(nextPos)

        if (range) {
          event.preventDefault()
          requestAnimationFrame(() => setEditorSelection(range.end, range.end))
          return true
        }
      }
    }

    if (
      !showMentionMenu &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const target =
        selectionLength > 0
          ? findRangeOverlappingSelection(selectionStart, selectionEnd)
          : findRangeContaining(selectionStart)

      if (target) {
        event.preventDefault()
        const nextPos = selectionStart <= target.start ? target.start : target.end
        requestAnimationFrame(() => {
          setEditorSelection(nextPos, nextPos)
        })
        return true
      }
    }

    if (showMentionMenu && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (inAggregated || aggregatedActive) {
        const aggregatedItems = buildAggregatedMentionItems(mentionQuery, mentionSources)
        const chosen =
          aggregatedItems[Math.max(0, Math.min(submenuActiveIndex, aggregatedItems.length - 1))]

        if (chosen) {
          handleAggregatedItemSelect(chosen)
        }
        return true
      }

      if (openSubmenuFor) {
        const items = getFilteredSubmenuItems(openSubmenuFor, submenuQuery)
        const chosen = items[Math.max(0, Math.min(submenuActiveIndex, items.length - 1))]

        if (chosen) {
          handleSubmenuItemSelect(openSubmenuFor, chosen)
        }
        return true
      }

      const selected = filterMentionOptions(mentionQuery)[mentionActiveIndex]
      if (selected) {
        handleMainMentionOptionSelect(selected)
      }
      return true
    }

    return false
  }

  useEffect(() => {
    if (!message) {
      setSelectedContexts([])
      lastSelectionRef.current = { start: 0, end: 0 }
      return
    }

    const presentLabels = new Set<string>()
    for (const range of computeMentionRanges()) {
      presentLabels.add(range.label)
    }

    setSelectedContexts((prev) =>
      prev.filter((context) => !!context.label && presentLabels.has(context.label))
    )
  }, [message])

  useEffect(() => {
    if (!showMentionMenu || openSubmenuFor) {
      setInAggregated(false)
      return
    }

    if (mentionQuery.length > 0) {
      for (const submenu of MENTION_SUBMENUS) {
        void loaders.ensureSubmenuLoaded(submenu)
      }
    }

    if (aggregatedActive) {
      setSubmenuActiveIndex(0)
      requestAnimationFrame(() => scrollActiveItemIntoView(0))
    }
  }, [showMentionMenu, openSubmenuFor, message])

  useEffect(() => {
    if (openSubmenuFor) {
      setInAggregated(false)
      setSubmenuActiveIndex(0)
      requestAnimationFrame(() => scrollActiveItemIntoView(0))
    }
  }, [openSubmenuFor])

  return {
    aggregatedActive,
    closeMentionMenu,
    clearSelectedContexts,
    handleAggregatedItemSelect,
    handleInputChange,
    insertTextAtSelection,
    handleKeyDown,
    handleMainMentionOptionSelect,
    handleOpenMentionMenuWithAt,
    handleSelectAdjust,
    handleSubmenuItemSelect,
    inAggregated,
    mentionActiveIndex,
    mentionQuery,
    mentionRanges,
    openSubmenuFor,
    selectedContexts,
    setInAggregated,
    setMentionActiveIndex,
    setSubmenuActiveIndex,
    showMentionMenu,
    submenuActiveIndex,
    submenuQuery,
  }
}
