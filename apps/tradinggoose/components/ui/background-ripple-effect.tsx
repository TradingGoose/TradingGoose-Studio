'use client'

// React Imports
import { useEffect, useMemo, useRef, useState } from 'react'

// Util Imports
import { cn } from '@/lib/utils'

const BackgroundRippleEffect = ({
  rows = 8,
  cols = 27,
  cellSize = 56.815
}: {
  rows?: number
  cols?: number
  cellSize?: number
}) => {
  // States
  const [clickedCell, setClickedCell] = useState<{ row: number; col: number } | null>(null)
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null)
  const [rippleKey, setRippleKey] = useState(0)

  // Hooks
  const ref = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const getCellFromPointer = (event: PointerEvent) => {
      const gridEl = gridRef.current
      if (!gridEl) return null

      const rect = gridEl.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null

      const col = Math.floor(x / cellSize)
      const row = Math.floor(y / cellSize)

      if (row < 0 || row >= rows || col < 0 || col >= cols) return null

      return { row, col }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const cell = getCellFromPointer(event)
      setHoveredCell(prev => {
        const isSameCell = prev?.row === cell?.row && prev?.col === cell?.col
        return isSameCell ? prev : cell
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const cell = getCellFromPointer(event)
      if (!cell) return

      setClickedCell(cell)
      setRippleKey(k => k + 1)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerdown', handlePointerDown)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [cellSize, cols, rows])

  return (
    <div
      ref={ref}
      className={cn(
        'absolute inset-0 h-full w-full object-center',
        '[--cell-border-color:var(--color-neutral-50)] [--cell-fill-color:transparent] [--cell-shadow-color:var(--color-neutral-500)]'
      )}
    >
      <div className='relative flex h-auto w-auto justify-center overflow-hidden'>
        <div className='pointer-events-none absolute inset-0 z-[2] h-full w-full overflow-hidden' />
        <DivGrid
          key={`base-${rippleKey}`}
          className='mask-radial-from-20% mask-radial-at-top opacity-40'
          rows={rows}
          cols={cols}
          cellSize={cellSize}
          borderColor='var(--cell-border-color)'
          fillColor='var(--cell-fill-color)'
          clickedCell={clickedCell}
          hoveredCell={hoveredCell}
          onCellClick={(row, col) => {
            setClickedCell({ row, col })
            setRippleKey(k => k + 1)
          }}
          interactive
          gridRef={gridRef}
        />
      </div>
    </div>
  )
}

type DivGridProps = {
  className?: string
  rows: number
  cols: number
  cellSize: number // in pixels
  borderColor: string
  fillColor: string
  clickedCell: { row: number; col: number } | null
  hoveredCell?: { row: number; col: number } | null
  onCellClick?: (row: number, col: number) => void
  interactive?: boolean
  gridRef?: React.RefObject<HTMLDivElement | null>
}

type CellStyle = React.CSSProperties & {
  ['--delay']?: string
  ['--duration']?: string
}

const DivGrid = ({
  className,
  rows = 7,
  cols = 30,
  cellSize = 56.815,
  borderColor = '#3f3f46',
  fillColor = 'rgba(14,165,233,0.3)',
  clickedCell = null,
  onCellClick = () => { },
  interactive = true,
  hoveredCell = null,
  gridRef
}: DivGridProps) => {
  const cells = useMemo(() => Array.from({ length: rows * cols }, (_, idx) => idx), [rows, cols])

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
    width: cols * cellSize,
    height: rows * cellSize,
    marginInline: 'auto'
  }

  return (
    <div ref={gridRef} className={cn('relative z-[3]', className)} style={gridStyle}>
      {cells.map(idx => {
        const rowIdx = Math.floor(idx / cols)
        const colIdx = idx % cols

        const distance = clickedCell ? Math.hypot(clickedCell.row - rowIdx, clickedCell.col - colIdx) : 0

        const delay = clickedCell ? Math.max(0, distance * 55) : 0 // ms
        const duration = 200 + distance * 80 // ms

        const style: CellStyle = clickedCell
          ? {
            '--delay': `${delay}ms`,
            '--duration': `${duration}ms`
          }
          : {}
        const isHovered = hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx

        return (
          <div
            key={idx}
            className={cn(
              'cell relative border-[1px] opacity-40 transition-all duration-150 will-change-transform hover:opacity-60 hover:brightness-95 shadow-[0px_0px_40px_1px_var(--cell-shadow-color)_inset] dark:hover:opacity-90',
              clickedCell && 'animate-cell-ripple [animation-fill-mode:none]',
              !interactive && 'pointer-events-none',
              isHovered && 'opacity-60 brightness-95'
            )}
            style={{
              backgroundColor: fillColor,
              borderColor: borderColor,
              ...style
            }}
            onClick={interactive ? () => onCellClick?.(rowIdx, colIdx) : undefined}
          />
        )
      })}
    </div>
  )
}

export { BackgroundRippleEffect }
