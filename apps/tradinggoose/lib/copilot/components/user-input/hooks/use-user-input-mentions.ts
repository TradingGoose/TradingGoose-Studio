'use client'

import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { useLocale } from 'next-intl'
import { isCopilotMentionBoundary } from '@/lib/copilot/chat-contexts'
import { useMonitorCopy } from '@/app/workspace/[workspaceId]/monitor/copy'
import type { ChatContext, CopilotDraftUpdate } from '@/stores/copilot/types'
import {
  buildCopilotWorkspaceEntityContext,
  isCopilotWorkspaceEntityMentionOption,
} from '../../../workspace-entities'
import { MENTION_SUBMENUS } from '../constants'
import {
  getMentionOptionLabel,
  getPastChatMentionLabel,
  getWorkspaceEntityMentionLabel,
  useCopilotMentionCopy,
} from '../mention-copy'
import {
  buildAggregatedMentionItems,
  buildMentionRanges,
  filterMentionItems,
  filterMentionOptions,
  retainMentionContextsInText,
  upsertMentionContextByTextOrder,
} from '../mention-utils'
import type {
  AggregatedMentionItem,
  MentionItem,
  MentionOption,
  MentionRange,
  MentionSources,
  MentionSubmenu,
  PastChatItem,
  WorkspaceEntityItem,
} from '../types'

interface UseUserInputMentionsOptions {
  draft: { text: string; contexts: ChatContext[] }
  isLoading: boolean
  menuListRef: RefObject<HTMLDivElement | null>
  mentionSources: MentionSources
  setDraft: (update: CopilotDraftUpdate) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  workspaceId: string
  loaders: {
    ensureSubmenuLoaded: (submenu: MentionSubmenu) => Promise<void>
  }
}

type MentionInsertion = { cursor: number; start: number; text: string }

export function useUserInputMentions({
  draft,
  isLoading,
  menuListRef,
  mentionSources,
  setDraft,
  textareaRef,
  workspaceId,
  loaders,
}: UseUserInputMentionsOptions) {
  const message = draft.text
  const selectedContexts = draft.contexts
  const locale = useLocale()
  const mentionCopy = useCopilotMentionCopy()
  const { copy: monitorCopy } = useMonitorCopy()
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
  const [openSubmenuFor, setOpenSubmenuFor] = useState<MentionSubmenu | null>(null)
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
  const [submenuQueryStart, setSubmenuQueryStart] = useState<number | null>(null)
  const [inAggregated, setInAggregated] = useState(false)
  const lastSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const ensureSubmenuLoaded = loaders.ensureSubmenuLoaded
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

  const getCaretPos = () => getSelection().start

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

  const computeMentionRanges = (
    text: string = message,
    contexts: ChatContext[] = selectedContexts
  ) => {
    return buildMentionRanges(text, contexts)
  }

  const mentionRanges = computeMentionRanges()

  const findRangeContaining = (pos: number) => {
    return computeMentionRanges().find((range) => pos > range.start && pos < range.end)
  }

  const findRangeOverlappingSelection = (start: number, end: number) => {
    return computeMentionRanges().find((range) => start < range.end && end > range.start)
  }

  const getActiveMentionQueryAtPosition = (
    pos: number,
    textOverride?: string,
    contextsOverride?: ChatContext[]
  ) => {
    const text = textOverride ?? message
    const before = text.slice(0, pos)
    const atIndex = before.lastIndexOf('@')

    if (atIndex === -1) {
      return null
    }

    if (atIndex > 0 && !isCopilotMentionBoundary(before.charAt(atIndex - 1))) {
      return null
    }

    const ranges = computeMentionRanges(text, contextsOverride)
    if (ranges.some((range) => atIndex >= range.start && atIndex < range.end)) {
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
  const hasMentionQuery = mentionQuery.length > 0
  const submenuQuery =
    openSubmenuFor && submenuQueryStart != null
      ? message.slice(submenuQueryStart, getCaretPos()).toLowerCase()
      : ''
  const aggregatedActive =
    showMentionMenu &&
    !openSubmenuFor &&
    hasMentionQuery &&
    filterMentionOptions(mentionQuery, mentionCopy).length === 0

  const closeMentionMenu = () => {
    setShowMentionMenu(false)
    setOpenSubmenuFor(null)
    setSubmenuQueryStart(null)
    setMentionActiveIndex(0)
    setSubmenuActiveIndex(0)
    setInAggregated(false)
  }

  const getFilteredSubmenuItems = (submenu: MentionSubmenu, query: string): MentionItem[] =>
    filterMentionItems(submenu, mentionSources, query, monitorCopy, mentionCopy)

  const buildInsertionAtCursor = (
    insertedText: string,
    currentText: string,
    selection: { start: number; end: number }
  ): MentionInsertion => {
    const start = Math.min(selection.start, currentText.length)
    const end = Math.max(start, Math.min(selection.end, currentText.length))
    let before = currentText.slice(0, start)
    const after = currentText.slice(end)

    if (before.endsWith('@') && insertedText.startsWith('@')) {
      before = before.slice(0, -1)
    }

    return {
      cursor: before.length + insertedText.length,
      start: before.length,
      text: `${before}${insertedText}${after}`,
    }
  }

  const insertAtCursor = (text: string) => {
    const selection = getSelection()
    const caretInsertion = buildInsertionAtCursor(text, message, selection)
    setDraft((previous) => {
      const nextInsertion = buildInsertionAtCursor(text, previous.text, selection)
      return {
        text: nextInsertion.text,
        contexts: retainMentionContextsInText(nextInsertion.text, previous.contexts),
      }
    })
    restoreEditorSelection(caretInsertion.cursor, caretInsertion.cursor)
  }

  const buildActiveMentionReplacement = (
    label: string,
    currentText: string,
    currentContexts: ChatContext[],
    selection: { start: number; end: number }
  ): MentionInsertion | null => {
    if (!textareaRef.current) return null

    const pos = Math.min(selection.start, currentText.length)
    const active = getActiveMentionQueryAtPosition(pos, currentText, currentContexts)

    if (!active) {
      return null
    }

    const before = currentText.slice(0, active.start)
    const after = currentText.slice(active.end)
    const trailingSpace = after.length > 0 && /^\s/.test(after) ? '' : ' '
    const insertion = `@${label}${trailingSpace}`
    const cursorPos = before.length + insertion.length
    return { cursor: cursorPos, start: before.length, text: `${before}${insertion}${after}` }
  }

  const insertMentionContext = (label: string, context: ChatContext) => {
    const selection = getSelection()
    const caretInsertion =
      buildActiveMentionReplacement(label, message, selectedContexts, selection) ??
      buildInsertionAtCursor(`@${label} `, message, selection)
    setDraft((previous) => {
      const nextInsertion =
        buildActiveMentionReplacement(label, previous.text, previous.contexts, selection) ??
        buildInsertionAtCursor(`@${label} `, previous.text, selection)
      const contexts = upsertMentionContextByTextOrder(
        retainMentionContextsInText(previous.text, previous.contexts),
        context,
        previous.text,
        nextInsertion.start
      )
      return {
        text: nextInsertion.text,
        contexts: retainMentionContextsInText(nextInsertion.text, contexts),
      }
    })
    restoreEditorSelection(caretInsertion.cursor, caretInsertion.cursor)
  }

  const resetActiveMentionQuery = () => {
    if (!textareaRef.current) return

    const selection = getSelection()
    const pos = Math.min(selection.start, message.length)
    const active = getActiveMentionQueryAtPosition(pos, message, selectedContexts)
    if (!active) return

    setDraft((previous) => {
      const currentPos = Math.min(selection.start, previous.text.length)
      const currentActive = getActiveMentionQueryAtPosition(
        currentPos,
        previous.text,
        previous.contexts
      )
      if (!currentActive) return previous

      const before = previous.text.slice(0, currentActive.start + 1)
      const after = previous.text.slice(currentActive.end)
      const next = `${before}${after}`
      return {
        text: next,
        contexts: retainMentionContextsInText(next, previous.contexts),
      }
    })

    const caretPos = active.start + 1
    restoreEditorSelection(caretPos, caretPos)
  }

  const insertPastChatMention = (chat: Pick<PastChatItem, 'reviewSessionId' | 'title'>) => {
    const label = getPastChatMentionLabel(mentionCopy, chat)
    insertMentionContext(label, {
      kind: 'past_chat',
      reviewSessionId: chat.reviewSessionId,
      label,
    })
    closeMentionMenu()
  }

  const insertWorkspaceEntityMention = (item: WorkspaceEntityItem) => {
    const label = getWorkspaceEntityMentionLabel(mentionCopy, item)
    insertMentionContext(
      label,
      buildCopilotWorkspaceEntityContext({
        entityKind: item.entityKind,
        entityId: item.id,
        workspaceId,
        ownerUserId: item.ownerUserId,
        label,
      })
    )
    closeMentionMenu()
  }

  const insertBlockMention = (block: { id: string; name: string }) => {
    const label = block.name || block.id
    insertMentionContext(label, { kind: 'blocks', blockTypes: [block.id], label })
    closeMentionMenu()
  }

  const insertDocsMention = () => {
    const label = getMentionOptionLabel(mentionCopy, 'docs')
    insertMentionContext(label, { kind: 'docs', label })
    closeMentionMenu()
  }

  const insertLogMention = (log: {
    id: string
    level: string
    trigger: string | null
    startedAt: string
    entityName: string
  }) => {
    const label = log.entityName
    insertMentionContext(label, {
      kind: 'logs',
      logId: log.id,
      workspaceId,
      label,
    })
    closeMentionMenu()
  }

  const insertMentionItem = (type: MentionSubmenu, item: MentionItem) => {
    if (type === 'chats') {
      insertPastChatMention(item as any)
    } else if (isCopilotWorkspaceEntityMentionOption(type)) {
      insertWorkspaceEntityMention(item as WorkspaceEntityItem)
    } else if (type === 'blocks') {
      insertBlockMention(item as any)
    } else if (type === 'logs') {
      insertLogMention(item as any)
    }
  }

  const handleSubmenuItemSelect = (submenu: MentionSubmenu, item: MentionItem) => {
    insertMentionItem(submenu, item)
    setSubmenuQueryStart(null)
  }

  const handleAggregatedItemSelect = (item: AggregatedMentionItem) => {
    insertMentionItem(item.type, item.value)
  }

  const openMentionSubmenu = (submenu: MentionSubmenu) => {
    resetActiveMentionQuery()
    setOpenSubmenuFor(submenu)
    setInAggregated(false)
    setSubmenuActiveIndex(0)
    setSubmenuQueryStart(getCaretPos())
    requestAnimationFrame(() => scrollActiveItemIntoView(0))
  }

  const handleMainMentionOptionSelect = (option: MentionOption) => {
    if (option === 'docs') {
      resetActiveMentionQuery()
      insertDocsMention()
      return
    }

    openMentionSubmenu(option)
  }

  const deleteRange = (range: MentionRange) => {
    setDraft((previous) => {
      const before = previous.text.slice(0, range.start)
      const after = previous.text.slice(range.end)
      const next =
        before.endsWith(' ') && after.startsWith(' ')
          ? `${before}${after.slice(1)}`
          : `${before}${after}`
      return {
        text: next,
        contexts: retainMentionContextsInText(previous.text, previous.contexts, range),
      }
    })

    restoreEditorSelection(range.start, range.start)
  }

  const handleInputChange = (
    newValue: string,
    selection: { start: number; end: number } = { start: newValue.length, end: newValue.length }
  ) => {
    setDraft((previous) => ({
      text: newValue,
      contexts: retainMentionContextsInText(newValue, previous.contexts),
    }))
    const normalizedSelection = {
      start: Math.max(0, Math.min(selection.start, newValue.length)),
      end: Math.max(0, Math.min(selection.end, newValue.length)),
    }
    lastSelectionRef.current = normalizedSelection

    const active = getActiveMentionQueryAtPosition(normalizedSelection.start, newValue)

    if (active) {
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
    const pos = selection.start
    const range =
      selection.start !== selection.end
        ? findRangeOverlappingSelection(selection.start, selection.end)
        : findRangeContaining(pos)

    if (range) {
      const snapPos =
        selection.start !== selection.end
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
    if (isLoading) {
      return
    }

    if (!textareaRef.current) return

    focusEditor()
    const pos = getSelection().start
    const needsSpaceBefore = pos > 0 && !/\s/.test(message.charAt(pos - 1))
    insertAtCursor(needsSpaceBefore ? ' @' : '@')
    setShowMentionMenu(true)
    setOpenSubmenuFor(null)
    setMentionActiveIndex(0)
    setSubmenuActiveIndex(0)
    setInAggregated(false)
    requestAnimationFrame(() => scrollActiveItemIntoView(0))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const selection = getSelection()
    const selectionStart = selection.start
    const selectionEnd = selection.end
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

      const filteredMain = openSubmenuFor ? [] : filterMentionOptions(mentionQuery, mentionCopy)
      const aggregatedItems =
        !openSubmenuFor && mentionQuery.length > 0
          ? buildAggregatedMentionItems(mentionQuery, mentionSources, monitorCopy, mentionCopy)
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

      const selected = filterMentionOptions(mentionQuery, mentionCopy)[mentionActiveIndex]
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
        const aggregatedItems = buildAggregatedMentionItems(
          mentionQuery,
          mentionSources,
          monitorCopy,
          mentionCopy
        )
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

      const selected = filterMentionOptions(mentionQuery, mentionCopy)[mentionActiveIndex]
      if (selected) {
        handleMainMentionOptionSelect(selected)
      }
      return true
    }

    return false
  }

  useEffect(() => {
    if (!showMentionMenu) return

    if (openSubmenuFor) {
      void ensureSubmenuLoaded(openSubmenuFor)
      return
    }

    if (hasMentionQuery) {
      for (const submenu of MENTION_SUBMENUS) {
        void ensureSubmenuLoaded(submenu)
      }
    }
  }, [showMentionMenu, openSubmenuFor, hasMentionQuery, locale, ensureSubmenuLoaded])

  return {
    aggregatedActive,
    closeMentionMenu,
    handleAggregatedItemSelect,
    handleInputChange,
    insertTextAtSelection: insertAtCursor,
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
