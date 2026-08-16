'use client'

import type { MentionRange } from './types'

export type MentionEditorSegment =
  | {
      type: 'text'
      key: string
      text: string
    }
  | {
      type: 'mention'
      key: string
      text: string
    }

export function buildMentionEditorSegments(
  message: string,
  ranges: MentionRange[]
): MentionEditorSegment[] {
  if (!message) {
    return []
  }

  if (ranges.length === 0) {
    return [{ type: 'text', key: 'text-0', text: message }]
  }

  const segments: MentionEditorSegment[] = []
  let lastIndex = 0

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]

    if (range.start > lastIndex) {
      segments.push({
        type: 'text',
        key: `text-${index}-${lastIndex}-${range.start}`,
        text: message.slice(lastIndex, range.start),
      })
    }

    segments.push({
      type: 'mention',
      key: `mention-${index}-${range.start}-${range.end}`,
      text: message.slice(range.start, range.end),
    })

    lastIndex = range.end
  }

  if (lastIndex < message.length) {
    segments.push({
      type: 'text',
      key: `tail-${lastIndex}`,
      text: message.slice(lastIndex),
    })
  }

  return segments
}

export function getMentionTextareaCaretClientRect(
  textarea: HTMLTextAreaElement,
  text: string,
  caretPos: number
): DOMRect | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const safeCaretPos = Math.max(0, Math.min(caretPos, text.length))
  const textareaRect = textarea.getBoundingClientRect()
  const styles = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')

  mirror.style.position = 'fixed'
  mirror.style.top = '0'
  mirror.style.left = '0'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflowWrap = styles.overflowWrap
  mirror.style.boxSizing = styles.boxSizing
  mirror.style.font = styles.font
  mirror.style.letterSpacing = styles.letterSpacing
  mirror.style.padding = styles.padding
  mirror.style.border = styles.border
  mirror.style.lineHeight = styles.lineHeight
  mirror.style.textAlign = styles.textAlign
  mirror.style.textIndent = styles.textIndent
  mirror.style.textTransform = styles.textTransform
  mirror.style.tabSize = styles.tabSize
  mirror.style.width = `${textarea.clientWidth}px`

  const marker = document.createElement('span')
  marker.textContent = '\u200B'

  mirror.textContent = text.slice(0, safeCaretPos)
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const mirrorRect = mirror.getBoundingClientRect()
  const markerRect = marker.getBoundingClientRect()
  const lineHeight = Number.parseFloat(styles.lineHeight) || markerRect.height || 0

  document.body.removeChild(mirror)

  return new DOMRect(
    textareaRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft,
    textareaRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop,
    0,
    lineHeight
  )
}
