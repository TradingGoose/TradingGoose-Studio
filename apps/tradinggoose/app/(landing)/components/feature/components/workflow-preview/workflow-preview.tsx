'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Workflow } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { LandingWidgetShell } from '../market-preview/landing-widget-shell'
import { WorkflowPreviewCanvas } from './workflow-preview-canvas'
import type { WorkflowPreviewDemo } from './workflow-preview-demos'

function WorkflowSelector({
  selectedDemo,
  demos,
  onSelect,
}: {
  selectedDemo: WorkflowPreviewDemo
  demos: WorkflowPreviewDemo[]
  onSelect: (demo: WorkflowPreviewDemo) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className={widgetHeaderControlClassName(
              'group flex min-w-[240px] items-center justify-between gap-1'
            )}
            aria-label={selectedDemo.name}
            aria-haspopup='listbox'
          />
        }
      >
        <div
          className='h-5 w-5 rounded-xs p-0.5'
          style={{ backgroundColor: `${selectedDemo.color}20` }}
          aria-hidden='true'
        >
          <Workflow className='h-4 w-4' aria-hidden='true' style={{ color: selectedDemo.color }} />
        </div>
        <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
          {selectedDemo.name}
        </span>
        <ChevronDown
          className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[popup-open]:rotate-180'
          aria-hidden='true'
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align='center'
        sideOffset={6}
        className={`${widgetHeaderMenuContentClassName} w-[260px]`}
      >
        {demos.map((demo) => {
          const isSelected = demo.id === selectedDemo.id

          return (
            <DropdownMenuItem
              key={demo.id}
              className={`${widgetHeaderMenuItemClassName} justify-between`}
              data-active={isSelected ? '' : undefined}
              onClick={() => {
                if (isSelected) return
                onSelect(demo)
              }}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <span
                  className='h-5 w-5 rounded-xs p-0.5'
                  style={{ backgroundColor: `${demo.color}20` }}
                  aria-hidden='true'
                >
                  <Workflow className='h-4 w-4' aria-hidden='true' style={{ color: demo.color }} />
                </span>
                <span className={`${widgetHeaderMenuTextClassName} truncate`}>{demo.name}</span>
              </div>
              {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface WorkflowPreviewProps {
  demos: WorkflowPreviewDemo[]
}

export function WorkflowPreview({ demos }: WorkflowPreviewProps) {
  const [selectedDemo, setSelectedDemo] = useState<WorkflowPreviewDemo | null>(demos[0] ?? null)

  useEffect(() => {
    setSelectedDemo((current) => {
      if (demos.length === 0) {
        return null
      }

      return demos.find((demo) => demo.id === current?.id) ?? demos[0]!
    })
  }, [demos])

  if (demos.length === 0 || !selectedDemo) {
    return null
  }

  return (
    <div className='flex h-full min-h-[560px] flex-col gap-4'>
      <LandingWidgetShell
        widgetKey='editor_workflow'
        className='min-h-0 flex-1'
        headerCenter={
          <WorkflowSelector
            selectedDemo={selectedDemo}
            demos={demos}
            onSelect={(demo) => setSelectedDemo(demo)}
          />
        }
      >
        <WorkflowPreviewCanvas
          workflowKey={selectedDemo.id}
          previewPayload={selectedDemo.previewPayload}
          className='h-full w-full flex-1'
        />
      </LandingWidgetShell>
    </div>
  )
}
