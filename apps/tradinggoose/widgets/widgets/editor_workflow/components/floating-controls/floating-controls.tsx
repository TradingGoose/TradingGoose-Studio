'use client'

import { Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useReactFlow, useStore } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import { cn } from '@/lib/utils'
import { useGeneralStore } from '@/stores/settings/general/store'

interface FloatingControlsProps {
  constrainToContainer?: boolean
}

export function FloatingControls({ constrainToContainer = false }: FloatingControlsProps) {
  const { zoomIn, zoomOut } = useReactFlow()
  // Subscribe to React Flow store so zoom % live-updates while zooming
  const zoom = useStore((s: any) =>
    Array.isArray(s.transform) ? s.transform[2] : s.viewport?.zoom
  )
  const workflowSession = useOptionalWorkflowSession()
  const { showFloatingControls } = useGeneralStore()
  const currentZoom = Math.round(((zoom as number) || 1) * 100)

  if (!showFloatingControls) return null

  const handleZoomIn = () => {
    zoomIn({ duration: 200 })
  }

  const handleZoomOut = () => {
    zoomOut({ duration: 200 })
  }

  const positionClass = constrainToContainer
    ? 'absolute bottom-3 left-1/2 -translate-x-1/2'
    : '-translate-x-1/2 fixed bottom-6 left-1/2'

  return (
    <div className={cn(positionClass, 'z-10')}>
      <div className='flex items-center gap-1 rounded-md border bg-card  p-1 shadow-xs'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleZoomOut}
              disabled={currentZoom <= 10}
              className={cn(
                'h-7 w-7 rounded-sm',
                'hover:bg-background',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Minus className='h-2.5 w-2.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <div className='flex w-12 items-center justify-center font-medium text-muted-foreground text-sm'>
          {currentZoom}%
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleZoomIn}
              disabled={currentZoom >= 200}
              className={cn(
                'h-7 w-7 rounded-sm',
                'hover:bg-background',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Plus className='h-2.5 w-2.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>

        <div className='mx-1 h-6 w-px bg-border' />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => workflowSession?.undo()}
              disabled={!workflowSession?.canUndo}
              className={cn(
                'h-7 w-7 rounded-sm',
                'hover:bg-background',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Undo2 className='h-2.5 w-2.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className='text-center'>
              <p>Undo</p>
              <p className='text-muted-foreground text-xs'>Cmd+Z</p>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => workflowSession?.redo()}
              disabled={!workflowSession?.canRedo}
              className={cn(
                'h-7 w-7 rounded-sm',
                'hover:bg-background',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Redo2 className='h-2.5 w-2.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className='text-center'>
              <p>Redo</p>
              <p className='text-muted-foreground text-xs'>Cmd+Shift+Z</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
