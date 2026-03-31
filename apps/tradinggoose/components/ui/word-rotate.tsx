'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface WordRotateProps {
  words: string[]
  duration?: number
  className?: string
  /** Controlled index — when provided, the component skips its own timer. */
  activeIndex?: number
}

export function useWordRotate(count: number, duration = 3000) {
  const [index, setIndex] = useState(0)

  const next = useCallback(() => {
    setIndex((prev) => (prev + 1) % count)
  }, [count])

  useEffect(() => {
    const id = setInterval(next, duration)
    return () => clearInterval(id)
  }, [next, duration])

  return index
}

export function WordRotate({ words, duration = 3000, className, activeIndex }: WordRotateProps) {
  const [internalIndex, setInternalIndex] = useState(0)

  const next = useCallback(() => {
    setInternalIndex((prev) => (prev + 1) % words.length)
  }, [words.length])

  useEffect(() => {
    if (activeIndex !== undefined) return
    const id = setInterval(next, duration)
    return () => clearInterval(id)
  }, [next, duration, activeIndex])

  const index = activeIndex !== undefined ? activeIndex % words.length : internalIndex

  return (
    <span className='inline-flex overflow-hidden'>
      <AnimatePresence mode='wait'>
        <motion.span
          key={words[index]}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
          className={cn('inline-block', className)}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
