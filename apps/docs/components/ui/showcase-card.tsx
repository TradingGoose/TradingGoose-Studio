'use client'

import { type ReactNode, useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ShowcaseCardProps {
  children: ReactNode
  caption?: string
  className?: string
}

export function ShowcaseCard({ children, caption, className }: ShowcaseCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <figure className={cn('my-6', className)}>
      <div
        ref={containerRef}
        className='relative overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm dark:bg-fd-card/50'
      >
        <RippleBg containerRef={containerRef} />
        <div className='relative z-10 flex items-center justify-center p-3 sm:p-6 md:p-10'>
          {children}
        </div>
      </div>
      {caption && (
        <figcaption className='mt-2 text-center text-xs text-fd-muted-foreground'>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

// ── Self-contained ripple grid ────────────────────────────────────
// Each instance is fully isolated — events scoped to its own container.

const CELL_SIZE = 56
const COLS = 25
const DEFAULT_ROWS = 12

interface RippleBgProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  rows?: number
}

function RippleBg({ containerRef, rows: minRows = DEFAULT_ROWS }: RippleBgProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [clickedCell, setClickedCell] = useState<{ row: number; col: number } | null>(null)
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null)
  const [rippleKey, setRippleKey] = useState(0)
  const [rows, setRows] = useState(minRows)

  // Auto-size rows to cover container height
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const needed = Math.ceil(entry.contentRect.height / CELL_SIZE) + 1
      setRows((prev) => Math.max(needed, minRows))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef, minRows])

  const cells = useMemo(() => Array.from({ length: rows * COLS }, (_, i) => i), [rows])

  const getCell = useCallback((e: PointerEvent) => {
    const grid = gridRef.current
    if (!grid) return null
    const rect = grid.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
    const col = Math.floor(x / CELL_SIZE)
    const row = Math.floor(y / CELL_SIZE)
    if (row < 0 || row >= rows || col < 0 || col >= COLS) return null
    return { row, col }
  }, [rows])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onMove = (e: PointerEvent) => {
      const cell = getCell(e)
      setHoveredCell((prev) =>
        prev?.row === cell?.row && prev?.col === cell?.col ? prev : cell
      )
    }
    const onDown = (e: PointerEvent) => {
      const cell = getCell(e)
      if (cell) {
        setClickedCell(cell)
        setRippleKey((k) => k + 1)
      }
    }
    const onLeave = () => setHoveredCell(null)

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [containerRef, getCell])

  return (
    <div
      className='pointer-events-none absolute inset-0 z-0 overflow-hidden'
      style={{
        maskImage:
          'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent), linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent), linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'destination-in' as string,
      }}
    >
      <div
        ref={gridRef}
        key={`grid-${rippleKey}`}
        className='opacity-40'
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, ${CELL_SIZE}px)`,
          gridTemplateRows: `repeat(${rows}, ${CELL_SIZE}px)`,
        }}
      >
        {cells.map((idx) => {
          const r = Math.floor(idx / COLS)
          const c = idx % COLS
          const dist = clickedCell ? Math.hypot(clickedCell.row - r, clickedCell.col - c) : 0
          const isHovered = hoveredCell?.row === r && hoveredCell?.col === c

          return (
            <div
              key={idx}
              className={cn(
                'border-[1px] opacity-50 transition-all duration-150 will-change-transform shadow-inner shadow-lg',
                'bg-fd-primary/10 border-neutral-500',
                clickedCell && 'animate-cell-ripple [animation-fill-mode:none]',
                isHovered && 'opacity-90 border-fd-primary brightness-95'
              )}
              style={
                clickedCell
                  ? ({
                      '--delay': `${Math.max(0, dist * 55)}ms`,
                      '--duration': `${200 + dist * 80}ms`,
                    } as React.CSSProperties)
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}

export { RippleBg }
