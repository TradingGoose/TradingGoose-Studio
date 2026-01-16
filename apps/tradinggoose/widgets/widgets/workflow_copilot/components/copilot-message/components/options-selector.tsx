'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import CopilotMarkdownRenderer from './markdown-renderer'
import { SmoothStreamingText } from './smooth-streaming'

/**
 * Plan step can be either a string or an object with title and plan
 */
type PlanStep = string | { title: string; plan?: string }

/**
 * Option can be either a string or an object with title and description
 */
type OptionItem = string | { title: string; description?: string }

export interface ParsedTags {
  plan?: Record<string, PlanStep>
  planComplete?: boolean
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
  const stringPattern = /"(\d+)":\s*"([^"]*?)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = match[2]
  }

  // Match complete object values: "key": {"title": "value"}
  const objectPattern = /"(\d+)":\s*\{[^}]*"title":\s*"([^"]*)"[^}]*\}/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    result[match[1]] = { title: match[2] }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Try to parse partial JSON for streaming plan steps.
 * Attempts to extract complete key-value pairs from incomplete JSON.
 */
function parsePartialPlanJson(jsonStr: string): Record<string, PlanStep> | null {
  // Try parsing as-is first (might be complete)
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Continue to partial parsing
  }

  const result: Record<string, PlanStep> = {}
  // Match complete string values: "key": "value"
  const stringPattern = /"(\d+)":\s*"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }

  // Match complete object values: "key": {"title": "value"}
  const objectPattern = /"(\d+)":\s*\{[^{}]*"title":\s*"((?:[^"\\]|\\.)*)"/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    result[match[1]] = { title: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n') }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Parse <plan> and <options> tags from content
 */
export function parseSpecialTags(content: string): ParsedTags {
  const result: ParsedTags = { cleanContent: content }

  // Parse <plan> tag - check for complete tag first
  const planMatch = content.match(/<plan>([\s\S]*?)<\/plan>/i)
  if (planMatch) {
    try {
      result.plan = JSON.parse(planMatch[1])
      result.planComplete = true
      result.cleanContent = result.cleanContent.replace(planMatch[0], '').trim()
    } catch {
      // Invalid JSON, ignore
    }
  } else {
    // Check for streaming/incomplete plan tag
    const streamingPlanMatch = content.match(/<plan>([\s\S]*)$/i)
    if (streamingPlanMatch) {
      const partialPlan = parsePartialPlanJson(streamingPlanMatch[1])
      if (partialPlan) {
        result.plan = partialPlan
        result.planComplete = false
      }
      // Strip the incomplete tag from clean content
      result.cleanContent = result.cleanContent.replace(streamingPlanMatch[0], '').trim()
    }
  }

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

  // Strip partial opening tags like "<opt" or "<pla" at the very end of content
  result.cleanContent = result.cleanContent.replace(/<[a-z]*$/i, '').trim()

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
  disabled = false,
  enableKeyboardNav = false,
  streaming = false,
}: {
  options: Record<string, OptionItem>
  onSelect: (optionKey: string, optionText: string) => void
  disabled?: boolean
  /** Only enable keyboard navigation for the active options (last message) */
  enableKeyboardNav?: boolean
  /** When true, looks enabled but interaction is disabled (for streaming state) */
  streaming?: boolean
}) {
  const isInteractionDisabled = disabled || streaming
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
  const containerRef = useRef<HTMLDivElement>(null)

  const isLocked = chosenKey !== null

  // Handle keyboard navigation - only for the active options selector
  useEffect(() => {
    if (isInteractionDisabled || !enableKeyboardNav || isLocked) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if the container or document body is focused (not when typing in input)
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
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
  }, [isInteractionDisabled, enableKeyboardNav, isLocked, sortedOptions, hoveredIndex, onSelect])

  if (sortedOptions.length === 0) return null

  return (
    <div ref={containerRef} className='flex flex-col gap-1 pb-1'>
      {sortedOptions.map((option, index) => {
        const isHovered = index === hoveredIndex && !isLocked
        const isChosen = option.key === chosenKey
        const isRejected = isLocked && !isChosen

        return (
          <div
            key={option.key}
            onClick={() => {
              if (!isInteractionDisabled && !isLocked) {
                setChosenKey(option.key)
                onSelect(option.key, option.title)
              }
            }}
            onMouseEnter={() => {
              if (!isLocked && !streaming) setHoveredIndex(index)
            }}
            className={cn(
              'group flex cursor-pointer items-start gap-2 rounded-md p-1 transition-colors',
              'hover:bg-muted/60',
              disabled && !isChosen && 'cursor-not-allowed opacity-50',
              streaming && 'pointer-events-none',
              isLocked && 'cursor-default',
              isHovered && !streaming && 'bg-muted/60'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded border border-border bg-background text-[11px] font-semibold text-muted-foreground transition-all',
                (isHovered || isChosen) && 'text-foreground shadow-sm'
              )}
            >
              {option.key}
            </span>

            <span
              className={cn(
                'min-w-0 flex-1 pt-0.5 text-xs text-muted-foreground leading-5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_p]:m-0 [&_p]:leading-5',
                isRejected && 'line-through opacity-50',
                (isHovered || isChosen) && 'text-foreground'
              )}
            >
              {streaming ? (
                <SmoothStreamingText content={option.title} isStreaming={true} />
              ) : (
                <CopilotMarkdownRenderer content={option.title} />
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
