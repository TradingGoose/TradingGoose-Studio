import { memo, useEffect, useRef, useState } from 'react'
import CopilotMarkdownRenderer from './markdown-renderer'

export const StreamingIndicator = memo(() => (
  <div className='flex items-center py-1 text-muted-foreground transition-opacity duration-200 ease-in-out'>
    <div className='flex space-x-0.5'>
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0ms', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.15s', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.3s', animationDuration: '1.2s' }}
      />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

interface SmoothStreamingTextProps {
  content: string
  isStreaming: boolean
  typingKey?: string
  onTypingStateChange?: (typingKey: string, isTyping: boolean) => void
}

const REVEAL_CHARS_PER_SECOND = 60
const REVEAL_CHARS_PER_MS = REVEAL_CHARS_PER_SECOND / 1000

export const SmoothStreamingText = memo(
  ({ content, isStreaming, typingKey, onTypingStateChange }: SmoothStreamingTextProps) => {
    const [displayedLength, setDisplayedLength] = useState(content.length)
    const frameRef = useRef<number | null>(null)
    const lastFrameTimeRef = useRef<number | null>(null)
    const revealCarryRef = useRef(0)
    const displayedLengthRef = useRef(content.length)
    const targetContentRef = useRef(content)
    const isTypingRef = useRef(false)

    useEffect(() => {
      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current)
        }
        if (typingKey && isTypingRef.current) {
          onTypingStateChange?.(typingKey, false)
        }
      }
    }, [onTypingStateChange, typingKey])

    useEffect(() => {
      targetContentRef.current = content

      const setTypingState = (isTyping: boolean) => {
        if (isTypingRef.current === isTyping) return
        isTypingRef.current = isTyping
        if (typingKey) {
          onTypingStateChange?.(typingKey, isTyping)
        }
      }

      const stopAnimation = () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current)
          frameRef.current = null
        }
        lastFrameTimeRef.current = null
        revealCarryRef.current = 0
      }

      const syncDisplayedLength = (nextLength: number) => {
        displayedLengthRef.current = nextLength
        setDisplayedLength(nextLength)
      }

      const tick = (timestamp: number) => {
        frameRef.current = null
        const previousTimestamp = lastFrameTimeRef.current ?? timestamp
        lastFrameTimeRef.current = timestamp
        revealCarryRef.current += (timestamp - previousTimestamp) * REVEAL_CHARS_PER_MS
        const advance = Math.floor(revealCarryRef.current)
        if (advance > 0) {
          revealCarryRef.current -= advance
          const targetContent = targetContentRef.current
          const currentLength = displayedLengthRef.current
          const nextLength = Math.min(targetContent.length, currentLength + advance)
          syncDisplayedLength(nextLength)
        }

        if (displayedLengthRef.current < targetContentRef.current.length) {
          setTypingState(true)
          frameRef.current = requestAnimationFrame(tick)
          return
        }

        stopAnimation()
        setTypingState(false)
      }

      if (content.length === 0) {
        stopAnimation()
        if (displayedLengthRef.current !== 0) {
          syncDisplayedLength(0)
        }
        setTypingState(false)
        return
      }

      if (displayedLengthRef.current > content.length) {
        stopAnimation()
        syncDisplayedLength(content.length)
      }

      if (displayedLengthRef.current === content.length) {
        stopAnimation()
        setTypingState(false)
        return
      }

      if (displayedLengthRef.current < content.length && frameRef.current === null) {
        setTypingState(true)
        frameRef.current = requestAnimationFrame(tick)
      }
    }, [content, isStreaming, onTypingStateChange, typingKey])

    const displayedContent = content.slice(0, displayedLength)

    return (
      <div
        className='relative max-w-full overflow-hidden whitespace-pre-wrap break-words'
        style={{ minHeight: '1.25rem' }}
      >
        <CopilotMarkdownRenderer content={displayedContent} />
      </div>
    )
  }
)

SmoothStreamingText.displayName = 'SmoothStreamingText'

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

export const WordWrap = ({ text }: { text: string }) => {
  if (!text) return null

  // Split text into words, keeping spaces and punctuation
  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        // If the part is whitespace or shorter than the max length, render it as is
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

        // For long words, break them up into chunks
        const chunks = []
        for (let i = 0; i < part.length; i += MAX_WORD_LENGTH) {
          chunks.push(part.substring(i, i + MAX_WORD_LENGTH))
        }

        return (
          <span key={index} className='break-all'>
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}
