'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/stores/copilot/types'
import CopilotMarkdownRenderer from './markdown-renderer'

type ThinkingContentBlock = Extract<
  NonNullable<CopilotMessage['contentBlocks']>[number],
  { type: 'thinking' }
>

interface ThinkingGroupProps {
  blocks: ThinkingContentBlock[]
  isStreaming?: boolean
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

function getThinkingDuration(block: ThinkingContentBlock): number | null {
  if (typeof block.duration === 'number' && block.duration > 0) {
    return block.duration
  }

  if (typeof block.startTime === 'number') {
    const duration = Date.now() - block.startTime
    return duration > 0 ? duration : null
  }

  return null
}

export function ThinkingGroup({ blocks, isStreaming = false }: ThinkingGroupProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const userCollapsedRef = useRef(false)

  const content = useMemo(
    () =>
      blocks
        .map((block) => block.content.trim())
        .filter(Boolean)
        .join('\n\n'),
    [blocks]
  )

  const totalDuration = useMemo(() => {
    let total = 0
    for (const block of blocks) {
      total += getThinkingDuration(block) ?? 0
    }
    return total
  }, [blocks])

  useEffect(() => {
    if (!isStreaming) {
      setIsExpanded(false)
      userCollapsedRef.current = false
      return
    }

    if (!userCollapsedRef.current) {
      setIsExpanded(true)
    }
  }, [content, isStreaming])

  const headerLabel = isStreaming
    ? 'Thinking...'
    : totalDuration > 0
      ? `Thought for ${formatDuration(totalDuration)}`
      : 'Finished thinking'

  return (
    <div className='w-full rounded-md border border-border/60 bg-muted/30'>
      <button
        type='button'
        onClick={() => {
          setIsExpanded((current) => {
            const next = !current
            if (!next && isStreaming) {
              userCollapsedRef.current = true
            }
            if (next) {
              userCollapsedRef.current = false
            }
            return next
          })
        }}
        className='flex w-full items-center gap-2 px-3 py-2 text-left'
      >
        <Brain className='h-3.5 w-3.5 flex-shrink-0 text-muted-foreground' />
        <span className='flex-1 text-muted-foreground text-xs italic'>{headerLabel}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform',
            !isExpanded && '-rotate-90'
          )}
        />
      </button>

      {isExpanded && content ? (
        <div className='border-border/60 border-t px-3 py-2'>
          <CopilotMarkdownRenderer content={content} />
          {isStreaming ? (
            <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-muted-foreground/80 align-middle' />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
