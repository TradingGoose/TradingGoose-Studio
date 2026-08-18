'use client'

import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Option can be either a string or an object with title and description
 */
type OptionItem = string | { title: string; description?: string }

function decodePartialJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value
  }
}

export interface ParsedTags {
  options?: Record<string, OptionItem>
  optionsComplete?: boolean
  cleanContent: string
}

/**
 * Try to parse partial JSON for streaming options.
 * Attempts to extract complete key-value pairs from incomplete JSON.
 */
function parsePartialOptionsJson(jsonStr: string): Record<string, OptionItem> | null {
  // Try parsing as-is first (might be complete)
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Continue to partial parsing
  }

  const result: Record<string, OptionItem> = {}
  // Match complete string values: "key": "value"
  const stringPattern = /"(\d+)":\s*"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = decodePartialJsonString(match[2])
  }

  // Match complete object values: "key": {"title": "value"}
  const objectPattern = /"(\d+)":\s*\{[^{}]*"title":\s*"((?:[^"\\]|\\.)*)"/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    result[match[1]] = { title: decodePartialJsonString(match[2]) }
  }

  return Object.keys(result).length > 0 ? result : null
}

/** Parse <options> tags from content. */
export function parseSpecialTags(content: string): ParsedTags {
  const result: ParsedTags = { cleanContent: content }

  // Parse <options> tag - check for complete tag first
  const optionsMatch = content.match(/<options>([\s\S]*?)<\/options>/i)
  if (optionsMatch) {
    try {
      result.options = JSON.parse(optionsMatch[1])
      result.optionsComplete = true
      result.cleanContent = result.cleanContent.replace(optionsMatch[0], '').trim()
    } catch {
      // Invalid JSON, ignore
    }
  } else {
    // Check for streaming/incomplete options tag
    const streamingOptionsMatch = content.match(/<options>([\s\S]*)$/i)
    if (streamingOptionsMatch) {
      const partialOptions = parsePartialOptionsJson(streamingOptionsMatch[1])
      if (partialOptions) {
        result.options = partialOptions
        result.optionsComplete = false
      }
      // Strip the incomplete tag from clean content
      result.cleanContent = result.cleanContent.replace(streamingOptionsMatch[0], '').trim()
    }
  }

  result.cleanContent = result.cleanContent.replace(/<opt(?:i(?:o(?:n(?:s)?)?)?)?$/i, '').trim()

  return result
}

/**
 * OptionsSelector component renders selectable options from the agent
 * Supports keyboard navigation (arrow up/down, enter) and click selection
 * After selection, shows the chosen option highlighted and others struck through
 */
export function OptionsSelector({
  options,
  onSelect,
}: {
  options: Record<string, OptionItem>
  onSelect: (optionKey: string, optionText: string) => void
}) {
  const sortedOptions = useMemo(() => {
    return Object.entries(options)
      .sort(([a], [b]) => {
        const numA = Number.parseInt(a, 10)
        const numB = Number.parseInt(b, 10)
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
        return a.localeCompare(b)
      })
      .map(([key, option]) => {
        const title = typeof option === 'string' ? option : option.title
        const description = typeof option === 'string' ? undefined : option.description
        return { key, title, description }
      })
      .slice(0, 5)
  }, [options])

  const [hoveredIndex, setHoveredIndex] = useState(0)
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const isLocked = chosenKey !== null

  // Handle keyboard navigation - only for the active options selector
  useEffect(() => {
    if (isLocked) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if the container or document body is focused (not when typing in input)
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'BUTTON' ||
        activeElement?.tagName === 'SELECT' ||
        activeElement?.tagName === 'A' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      if (isInputFocused) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHoveredIndex((prev) => Math.min(prev + 1, sortedOptions.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHoveredIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = sortedOptions[hoveredIndex]
        if (selected) {
          setChosenKey(selected.key)
          onSelect(selected.key, selected.title)
        }
      } else if (/^[1-9]$/.test(e.key)) {
        // Number keys select that option directly
        const optionIndex = sortedOptions.findIndex((opt) => opt.key === e.key)
        if (optionIndex !== -1) {
          e.preventDefault()
          const selected = sortedOptions[optionIndex]
          setChosenKey(selected.key)
          onSelect(selected.key, selected.title)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isLocked, sortedOptions, hoveredIndex, onSelect])

  if (sortedOptions.length === 0) return null

  return (
    <div className='flex flex-col gap-1 pb-1'>
      {sortedOptions.map((option, index) => {
        const isHovered = index === hoveredIndex && !isLocked
        const isChosen = option.key === chosenKey
        const isRejected = isLocked && !isChosen

        return (
          <button
            type='button'
            key={option.key}
            disabled={isLocked}
            aria-pressed={isChosen}
            onClick={() => {
              if (!isLocked) {
                setChosenKey(option.key)
                onSelect(option.key, option.title)
              }
            }}
            onMouseEnter={() => {
              if (!isLocked) setHoveredIndex(index)
            }}
            className={cn(
              'group flex w-full cursor-pointer items-center gap-2 rounded-md p-1 text-left transition-colors',
              'hover:bg-muted/60',
              isLocked && 'cursor-default',
              isHovered && 'bg-muted/60'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded border border-border bg-background font-semibold text-[11px] text-muted-foreground transition-all',
                (isHovered || isChosen) && 'text-foreground shadow-sm'
              )}
            >
              {option.key}
            </span>

            <span
              className={cn(
                'min-w-0 flex-1 pt-0.5 text-muted-foreground text-xs leading-5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_p]:m-0 [&_p]:leading-5',
                isRejected && 'line-through opacity-50',
                (isHovered || isChosen) && 'text-foreground'
              )}
            >
              {option.title}
            </span>
          </button>
        )
      })}
    </div>
  )
}
