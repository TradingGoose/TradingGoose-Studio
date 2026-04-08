'use client'

import type { ComponentType } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useReviewSessionUndoRedoState } from '@/widgets/widgets/entity_review/review-session-controls'

// ── Generic header button ───────────────────────────────────────────────────

export interface EntityEditorHeaderButtonProps {
  tooltip: string
  label: string
  icon: ComponentType<{ className?: string }>
  disabled?: boolean
  variant?: 'default' | 'secondary' | 'outline' | 'ghost'
  onClick: () => void
}

/**
 * Shared header button used by every entity editor (indicator, skill,
 * custom-tool, mcp). Renders a 28x28 icon button inside a tooltip.
 */
export function EntityEditorHeaderButton({
  tooltip,
  label,
  icon: Icon,
  disabled,
  variant = 'outline',
  onClick,
}: EntityEditorHeaderButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant={variant}
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={onClick}
            disabled={disabled}
          >
            <Icon className='h-4 w-4' />
            <span className='sr-only'>{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

// ── Undo / Redo buttons ─────────────────────────────────────────────────────

interface UndoRedoButtonProps {
  reviewSessionId?: string | null
  onAction: () => void
}

export function EntityEditorUndoButton({ reviewSessionId, onAction }: UndoRedoButtonProps) {
  const { canUndo } = useReviewSessionUndoRedoState(reviewSessionId)

  return (
    <EntityEditorHeaderButton
      tooltip='Undo'
      label='Undo'
      icon={Undo2}
      disabled={!canUndo}
      onClick={onAction}
    />
  )
}

export function EntityEditorRedoButton({ reviewSessionId, onAction }: UndoRedoButtonProps) {
  const { canRedo } = useReviewSessionUndoRedoState(reviewSessionId)

  return (
    <EntityEditorHeaderButton
      tooltip='Redo'
      label='Redo'
      icon={Redo2}
      disabled={!canRedo}
      onClick={onAction}
    />
  )
}
