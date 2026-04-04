'use client'

import { useState } from 'react'
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
} from '@/widgets/widgets/components/widget-header-control'
import { LandingWidgetShell } from '../market-preview/landing-widget-shell'
import { WorkflowPreviewCanvas } from './workflow-preview-canvas'
import { TRADING_AGENT_WORKFLOW_DEMOS, type WorkflowPreviewDemo } from './workflow-preview-demos'

function WorkflowSelector({
  selectedDemo,
  onSelect,
}: {
  selectedDemo: WorkflowPreviewDemo
  onSelect: (demo: WorkflowPreviewDemo) => void
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className={widgetHeaderControlClassName(
            'group flex min-w-[240px] items-center justify-between gap-1'
          )}
          aria-label={selectedDemo.name}
          aria-haspopup='listbox'
        >
          <div
            className='h-5 w-5 rounded-xs p-0.5'
            style={{ backgroundColor: `${selectedDemo.color}20` }}
            aria-hidden='true'
          >
            <Workflow
              className='h-4 w-4'
              aria-hidden='true'
              style={{ color: selectedDemo.color }}
            />
          </div>
          <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
            {selectedDemo.name}
          </span>
          <ChevronDown
            className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
            aria-hidden='true'
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align='center'
        sideOffset={6}
        className={`${widgetHeaderMenuContentClassName} w-[260px]`}
      >
        {TRADING_AGENT_WORKFLOW_DEMOS.map((demo) => {
          const isSelected = demo.id === selectedDemo.id

          return (
            <DropdownMenuItem
              key={demo.id}
              className={`${widgetHeaderMenuItemClassName} justify-between`}
              data-active={isSelected ? '' : undefined}
              onSelect={() => {
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

export function WorkflowPreview() {
  const [selectedDemo, setSelectedDemo] = useState(TRADING_AGENT_WORKFLOW_DEMOS[0])

  return (
    <div className='flex h-full min-h-[560px] flex-col gap-4'>
      <LandingWidgetShell
        widgetKey='editor_workflow'
        className='min-h-0 flex-1'
        headerCenter={
          <WorkflowSelector
            selectedDemo={selectedDemo}
            onSelect={(demo) => setSelectedDemo(demo)}
          />
        }
      >
        <WorkflowPreviewCanvas
          workflowKey={selectedDemo.id}
          workflowState={selectedDemo.workflowState}
          className='h-full w-full flex-1'
        />
      </LandingWidgetShell>
    </div>
  )
}
