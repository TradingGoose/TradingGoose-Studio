'use client'

import { useState } from 'react'
import { PenTool, Shapes, TextCursorInput } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DRAW_ACTION_ICONS,
  DRAW_ACTION_LABELS,
  DRAW_TOOL_FAMILY_GROUPS,
  DRAW_TOOL_ICONS,
  DRAW_TOOL_LABELS,
  type DrawToolActionType,
} from '@/widgets/widgets/data_chart/components/draw-tool-icon-registry'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import type {
  OwnerVisibilityMode,
  ToolCreateCapability,
} from '@/widgets/widgets/data_chart/drawings/use-adapter'

type DrawToolsSidebarProps = {
  activeOwnerId: string | null
  sidebarWidthPx: number
  hasOwnerTools: boolean
  allVisibilityMode: OwnerVisibilityMode
  getToolCapability: (toolType: ManualToolType) => ToolCreateCapability
  isNonSelectableToolActive: (toolType: ManualToolType) => boolean
  onSelectTool: (toolType: ManualToolType) => void
  onToggleAllVisibility: () => void
  onClearAll: () => void
}

const buttonClass =
  'inline-flex p-1 items-center justify-center rounded-xs border border-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

const groupButtonClass =
  'inline-flex p-1 items-center justify-center rounded-xs border border-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'

export const DrawToolsSidebar = ({
  activeOwnerId,
  sidebarWidthPx,
  hasOwnerTools,
  allVisibilityMode,
  getToolCapability,
  isNonSelectableToolActive,
  onSelectTool,
  onToggleAllVisibility,
  onClearAll,
}: DrawToolsSidebarProps) => {
  const [openGroup, setOpenGroup] = useState<'lines' | 'notes' | 'freehand' | 'shapes' | null>(null)
  const canInteract = Boolean(activeOwnerId)
  const canToggleAllVisibility = canInteract && hasOwnerTools
  const allVisibilityAction: DrawToolActionType =
    allVisibilityMode === 'show' ? 'showAll' : 'hideAll'
  const ToggleAllVisibilityIcon = DRAW_ACTION_ICONS[allVisibilityAction]
  const toggleAllVisibilityLabel = DRAW_ACTION_LABELS[allVisibilityAction]
  const ClearAllIcon = DRAW_ACTION_ICONS.clearAll

  const resolveTooltip = (toolType: ManualToolType) => {
    const capability = getToolCapability(toolType)
    if (capability === 'unsupported') {
      return `${DRAW_TOOL_LABELS[toolType]} is unavailable in this session`
    }
    return DRAW_TOOL_LABELS[toolType]
  }

  return (
    <div
      className='pointer-events-auto absolute top-0 bottom-0 left-0 z-20'
      style={{ width: `${sidebarWidthPx}px` }}
    >
      <div className='flex h-full w-full flex-col items-center gap-1 border-border border-r bg-background py-1'>
        <div
          className='flex flex-col items-center gap-1'
          onMouseEnter={() => setOpenGroup('lines')}
          onMouseLeave={() => setOpenGroup(null)}
        >
          <DropdownMenu
            open={openGroup === 'lines'}
            onOpenChange={(nextOpen) => setOpenGroup(nextOpen ? 'lines' : null)}
          >
            <DropdownMenuTrigger asChild>
              <button type='button' className={groupButtonClass} disabled={!canInteract}>
                {(() => {
                  const LinesIcon = DRAW_TOOL_ICONS.TrendLine
                  return <LinesIcon className='h-4 w-4' />
                })()}
                <span className='sr-only'>Lines tools</span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side='right' align='start' className='w-44 p-1'>
              {DRAW_TOOL_FAMILY_GROUPS.lines.map((toolType) => {
                const ToolIcon = DRAW_TOOL_ICONS[toolType]
                const capability = getToolCapability(toolType)
                const unavailable = capability === 'unsupported'
                const isActive = isNonSelectableToolActive(toolType)
                return (
                  <DropdownMenuItem
                    key={toolType}
                    disabled={!canInteract || unavailable}
                    className={`gap-2 ${isActive ? 'bg-muted text-foreground' : ''}`}
                    onClick={() => onSelectTool(toolType)}
                  >
                    <ToolIcon className='h-4 w-4' />
                    <span>{DRAW_TOOL_LABELS[toolType]}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className='flex flex-col items-center gap-1'
          onMouseEnter={() => setOpenGroup('notes')}
          onMouseLeave={() => setOpenGroup(null)}
        >
          <DropdownMenu
            open={openGroup === 'notes'}
            onOpenChange={(nextOpen) => setOpenGroup(nextOpen ? 'notes' : null)}
          >
            <DropdownMenuTrigger asChild>
              <button type='button' className={groupButtonClass} disabled={!canInteract}>
                <TextCursorInput className='h-4 w-4' />
                <span className='sr-only'>Notes tools</span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side='right' align='start' className='w-44 p-1'>
              {DRAW_TOOL_FAMILY_GROUPS.notes.map((toolType) => {
                const ToolIcon = DRAW_TOOL_ICONS[toolType]
                const capability = getToolCapability(toolType)
                const unavailable = capability === 'unsupported'
                const isActive = isNonSelectableToolActive(toolType)
                return (
                  <DropdownMenuItem
                    key={toolType}
                    disabled={!canInteract || unavailable}
                    className={`gap-2 ${isActive ? 'bg-muted text-foreground' : ''}`}
                    onClick={() => onSelectTool(toolType)}
                  >
                    <ToolIcon className='h-4 w-4' />
                    <span>{DRAW_TOOL_LABELS[toolType]}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className='flex flex-col items-center gap-1'
          onMouseEnter={() => setOpenGroup('freehand')}
          onMouseLeave={() => setOpenGroup(null)}
        >
          <DropdownMenu
            open={openGroup === 'freehand'}
            onOpenChange={(nextOpen) => setOpenGroup(nextOpen ? 'freehand' : null)}
          >
            <DropdownMenuTrigger asChild>
              <button type='button' className={groupButtonClass} disabled={!canInteract}>
                <PenTool className='h-4 w-4' />
                <span className='sr-only'>Freehand tools</span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side='right' align='start' className='w-44 p-1'>
              {DRAW_TOOL_FAMILY_GROUPS.freehand.map((toolType) => {
                const ToolIcon = DRAW_TOOL_ICONS[toolType]
                const capability = getToolCapability(toolType)
                const unavailable = capability === 'unsupported'
                const isActive = isNonSelectableToolActive(toolType)
                return (
                  <DropdownMenuItem
                    key={toolType}
                    disabled={!canInteract || unavailable}
                    className={`gap-2 ${isActive ? 'bg-muted text-foreground' : ''}`}
                    onClick={() => onSelectTool(toolType)}
                  >
                    <ToolIcon className='h-4 w-4' />
                    <span>{DRAW_TOOL_LABELS[toolType]}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className='flex flex-col items-center gap-1'
          onMouseEnter={() => setOpenGroup('shapes')}
          onMouseLeave={() => setOpenGroup(null)}
        >
          <DropdownMenu
            open={openGroup === 'shapes'}
            onOpenChange={(nextOpen) => setOpenGroup(nextOpen ? 'shapes' : null)}
          >
            <DropdownMenuTrigger asChild>
              <button type='button' className={groupButtonClass} disabled={!canInteract}>
                <Shapes className='h-4 w-4' />
                <span className='sr-only'>Shapes tools</span>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent side='right' align='start' className='w-44 p-1'>
              {DRAW_TOOL_FAMILY_GROUPS.shapes.map((toolType) => {
                const ToolIcon = DRAW_TOOL_ICONS[toolType]
                const capability = getToolCapability(toolType)
                const unavailable = capability === 'unsupported'
                const isActive = isNonSelectableToolActive(toolType)
                return (
                  <DropdownMenuItem
                    key={toolType}
                    disabled={!canInteract || unavailable}
                    className={`gap-2 ${isActive ? 'bg-muted text-foreground' : ''}`}
                    onClick={() => onSelectTool(toolType)}
                  >
                    <ToolIcon className='h-4 w-4' />
                    <span>{DRAW_TOOL_LABELS[toolType]}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {DRAW_TOOL_FAMILY_GROUPS.singles.map((toolType) => {
          const ToolIcon = DRAW_TOOL_ICONS[toolType]
          const capability = getToolCapability(toolType)
          const unavailable = capability === 'unsupported'
          const isActive = isNonSelectableToolActive(toolType)

          return (
            <Tooltip key={toolType}>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  className={`${buttonClass} ${isActive ? 'border-border/40 bg-muted text-foreground' : ''}`}
                  disabled={!canInteract || unavailable}
                  onClick={() => onSelectTool(toolType)}
                >
                  <ToolIcon className='h-4 w-4' />
                  <span className='sr-only'>{DRAW_TOOL_LABELS[toolType]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side='right'>{resolveTooltip(toolType)}</TooltipContent>
            </Tooltip>
          )
        })}

        <div className='mt-auto mb-1 flex flex-col items-center gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={buttonClass}
                disabled={!canToggleAllVisibility}
                onClick={onToggleAllVisibility}
              >
                <ToggleAllVisibilityIcon className='h-4 w-4' />
                <span className='sr-only'>{toggleAllVisibilityLabel}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='right'>{toggleAllVisibilityLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                className={buttonClass}
                disabled={!canInteract}
                onClick={onClearAll}
              >
                <ClearAllIcon className='h-4 w-4' />
                <span className='sr-only'>{DRAW_ACTION_LABELS.clearAll}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side='right'>{DRAW_ACTION_LABELS.clearAll}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
