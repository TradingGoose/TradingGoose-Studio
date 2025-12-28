'use client'

import { AlertCircle, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, Button, Skeleton } from '@/components/ui'
import { cn } from '@/lib/utils'
import { formatAbsoluteDate, formatRelativeTime } from '@/app/workspace/[workspaceId]/mcp/components/mcp-formatters'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'

interface CustomToolListProps {
  toolsLoading: boolean
  toolsError: string | null
  hasTools: boolean
  filteredTools: CustomToolDefinition[]
  selectedToolId: string | null
  onSelect: (toolId: string) => void
  onDelete: (toolId: string) => void
  showNoResults: boolean
  searchTerm: string
  onStartCreate: () => void
  createForm?: ReactNode
  deletingTools: Set<string>
}

export function CustomToolList({
  toolsLoading,
  toolsError,
  hasTools,
  filteredTools,
  selectedToolId,
  onSelect,
  onDelete,
  showNoResults,
  searchTerm,
  onStartCreate,
  createForm,
  deletingTools,
}: CustomToolListProps) {
  return (
    <div className='relative flex h-full flex-col p-3'>
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto'>
        <div className='pb-6'>
          {toolsError && (
            <Alert variant='destructive'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{toolsError}</AlertDescription>
            </Alert>
          )}

          {toolsLoading ? (
            <div className='space-y-4'>
              <CustomToolSkeleton />
              <CustomToolSkeleton />
              <CustomToolSkeleton />
            </div>
          ) : (
            <>
              {hasTools ? (
                <div className='space-y-4'>
                  {filteredTools.map((tool) => {
                    if (!tool || !tool.id) return null

                    const parameterEntries =
                      Object.entries(tool.schema?.function?.parameters?.properties ?? {}) || []

                    return (
                      <div
                        key={tool.id}
                        className={cn(
                          'group rounded-md border p-4 transition-colors hover:bg-secondary/10',
                          selectedToolId === tool.id && 'bg-secondary/30'
                        )}
                      >
                        <div className='flex flex-col gap-4 md:flex-row md:items-start md:justify-between'>
                          <div className='space-y-2'>
                            <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                              <span>{tool.title || tool.schema?.function?.name || 'Custom Tool'}</span>
                              <div className='flex flex-wrap gap-2 text-muted-foreground text-[11px]'>
                                {tool.updatedAt && (
                                  <span title={`Updated ${formatAbsoluteDate(tool.updatedAt)}`}>
                                    Updated {formatRelativeTime(tool.updatedAt)}
                                  </span>
                                )}
                                {tool.createdAt && (
                                  <span title={`Created ${formatAbsoluteDate(tool.createdAt)}`}>
                                    Created {formatRelativeTime(tool.createdAt)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {tool.schema?.function?.description && (
                              <p className='text-muted-foreground text-xs leading-relaxed'>
                                {tool.schema.function.description}
                              </p>
                            )}

                            {parameterEntries.length > 0 && (
                              <div className='flex flex-wrap gap-2 pt-1'>
                                {parameterEntries.slice(0, 4).map(([name]) => (
                                  <span
                                    key={name}
                                    className='inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground'
                                  >
                                    {name}
                                  </span>
                                ))}
                                {parameterEntries.length > 4 && (
                                  <span className='text-muted-foreground text-xs'>
                                    +{parameterEntries.length - 4} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className='flex items-center justify-center gap-2 self-start'>
                            <Button
                              type='button'
                              variant='outline'
                              size='sm'
                              className='h-7'
                              onClick={() => onSelect(tool.id)}
                            >
                              Detail
                            </Button>
                            <button
                              type='button'
                              onClick={(event) => {
                                event.stopPropagation()
                                event.preventDefault()
                                onDelete(tool.id)
                              }}
                              disabled={deletingTools.has(tool.id)}
                              className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                              <span className='sr-only'>Delete tool</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className='rounded-md border bg-card p-10 text-center shadow-sm'>
                  <p className='font-medium'>No custom tools yet</p>
                  <p className='mt-2 text-muted-foreground'>
                    Create custom tools to reuse across your workspace workflows.
                  </p>
                  <Button className='mt-4' onClick={onStartCreate}>
                    Add Tool
                  </Button>
                </div>
              )}

              {showNoResults && (
                <div className='rounded-xl border border-dashed bg-muted/40 px-6 py-4 text-center text-muted-foreground text-sm'>
                  No tools found matching "{searchTerm}"
                </div>
              )}
            </>
          )}

          {createForm}
        </div>
      </div>
    </div>
  )
}

function CustomToolSkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-40 rounded-sm' />
          <Skeleton className='h-4 w-24' />
          <Skeleton className='h-1 w-1 rounded-full' />
          <Skeleton className='h-4 w-16' />
        </div>
        <Skeleton className='h-8 w-16' />
      </div>
      <div className='mt-1 ml-2 flex flex-wrap gap-1'>
        <Skeleton className='h-5 w-16 rounded' />
        <Skeleton className='h-5 w-20 rounded' />
        <Skeleton className='h-5 w-14 rounded' />
      </div>
    </div>
  )
}
