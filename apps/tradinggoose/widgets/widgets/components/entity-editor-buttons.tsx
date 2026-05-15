'use client'

import type { ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
