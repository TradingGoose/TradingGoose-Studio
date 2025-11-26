'use client'

import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { ConsoleEntry } from '..'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useConsoleStore } from '@/stores/panel/console/store'

interface ConsoleProps {
  panelWidth: number
  hideScrollbar?: boolean
}

export function Console({ panelWidth, hideScrollbar = true }: ConsoleProps) {
  const entries = useConsoleStore((state) => state.entries)
  const { workflowId } = useWorkflowRoute()

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === workflowId)
  }, [entries, workflowId])

  return (
    <div className='h-full pt-2'>
      {filteredEntries.length === 0 ? (
        <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
          No console entries
        </div>
      ) : (
        <ScrollArea
          className={cn('h-full px-2 pb-2', !hideScrollbar && 'pr-2')}
          hideScrollbar={hideScrollbar}
        >
          <div className={cn('space-y-3', !hideScrollbar && 'pr-1')}>
            {filteredEntries.map((entry) => (
              <ConsoleEntry key={entry.id} entry={entry} consoleWidth={panelWidth} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
