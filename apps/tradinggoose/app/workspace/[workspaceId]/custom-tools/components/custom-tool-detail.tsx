'use client'

import { Pencil, Trash2, Wrench, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { cn } from '@/lib/utils'
import { formatAbsoluteDate, formatRelativeTime } from '@/app/workspace/[workspaceId]/mcp/components/mcp-formatters'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'

interface CustomToolDetailsProps {
  tool: CustomToolDefinition | null
  onEdit: (tool: CustomToolDefinition) => void
  onClosePanel: () => void
  onDelete?: (toolId: string) => void
  isDeleting?: boolean
  isEditing?: boolean
  formContent?: ReactNode
  onCancelEdit?: () => void
}

export function CustomToolDetails({
  tool,
  onEdit,
  onClosePanel,
  onDelete,
  isDeleting,
  isEditing = false,
  formContent,
  onCancelEdit,
}: CustomToolDetailsProps) {
  if (!tool) {
    return (
      <div className='flex h-full items-center justify-center bg-card text-muted-foreground text-sm'>
        Select a custom tool to view its details.
      </div>
    )
  }

  const parameters = Object.entries(tool.schema?.function?.parameters?.properties ?? {})
  const requiredParams = tool.schema?.function?.parameters?.required ?? []
  const functionName = tool.schema?.function?.name || tool.title || 'Custom Tool'
  const description = tool.schema?.function?.description

  return (
    <div className='flex h-full flex-col rounded-lg border border-border bg-card'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b bg-card/50 p-3'>
        <div className='space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <Wrench className='h-4 w-4 text-muted-foreground' />
            <h3 className='text-lg font-semibold leading-tight'>{tool.title || functionName}</h3>
            <span className='inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium border-border bg-muted text-muted-foreground'>
              Custom Tool
            </span>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {isEditing ? (
            <Button
              variant='outline'
              size='icon'
              onClick={onCancelEdit ?? onClosePanel}
              className='h-7 w-7'
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close editing</span>
            </Button>
          ) : (
            <>
              <Button
                variant='outline'
                size='icon'
                onClick={() => onEdit(tool)}
                className='h-7 w-7'
                disabled={isDeleting}
              >
                <Pencil className='h-4 w-4' />
                <span className='sr-only'>Edit tool</span>
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={onClosePanel}
                className='h-7 w-7 p-0 text-muted-foreground hover:text-foreground'
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Close details</span>
              </Button>
            </>
          )}
        </div>
      </div>

      <div className='flex-1 space-y-5 overflow-auto px-5 py-4'>
        {isEditing && formContent ? (
          <div className='h-full'>{formContent}</div>
        ) : (
          <>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-2'>
              <InfoCard label='Function Name' value={formatDisplayText(functionName)} />
              <InfoCard label='Parameters' value={parameters.length} />
              <InfoCard
                label='Updated'
                value={
                  tool.updatedAt ? (
                    <DateDisplay timestamp={tool.updatedAt} />
                  ) : (
                    <span className='text-muted-foreground'>Not updated</span>
                  )
                }
              />
              <InfoCard
                label='Created'
                value={
                  tool.createdAt ? (
                    <DateDisplay timestamp={tool.createdAt} />
                  ) : (
                    <span className='text-muted-foreground'>Unknown</span>
                  )
                }
              />
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Description</p>
                {!description && <span className='text-muted-foreground text-xs'>None provided</span>}
              </div>
              {description ? (
                <p className='rounded-md border bg-secondary/30 p-3 text-sm leading-relaxed text-foreground'>
                  {formatDisplayText(description)}
                </p>
              ) : (
                <p className='text-muted-foreground text-sm'>No description available.</p>
              )}
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Parameters</p>
                <span className='text-muted-foreground text-xs'>{parameters.length} total</span>
              </div>
              {parameters.length > 0 ? (
                <div className='mt-1 space-y-2'>
                  {parameters.map(([name, schema]) => (
                    <div key={name} className='rounded-md border bg-secondary/30 p-3'>
                      <div className='flex items-start justify-between gap-2'>
                        <div>
                          <p className='pb-1 font-medium text-md'>{name}</p>
                          <p className='text-muted-foreground text-xs leading-relaxed'>
                            {schema?.description || 'No description'}
                          </p>
                          <div className='mt-1 text-muted-foreground text-[11px]'>
                            <span className='mr-2 uppercase tracking-wide'>Type:</span>
                            <span className='text-foreground'>{schema?.type || 'unknown'}</span>
                          </div>
                        </div>
                        {requiredParams.includes(name) && (
                          <span className='inline-flex items-center rounded-full border border-amber-700 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700'>
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>No parameters defined.</p>
              )}
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground text-xs uppercase tracking-wide'>Schema</p>
                <span className='text-muted-foreground text-xs'>JSON</span>
              </div>
              <div className='rounded-lg border bg-muted/60 p-3'>
                <pre className='max-h-64 overflow-auto rounded p-3 font-mono text-xs leading-relaxed text-foreground/90'>
                  {JSON.stringify(tool.schema, null, 2)}
                </pre>
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <p className='text-muted-foreground  text-xs uppercase tracking-wide'>Code</p>
                <span className='text-muted-foreground text-xs '>
                  {tool.code?.trim() ? `${tool.code.split('\n').length} lines` : 'Optional'}
                </span>
              </div>
              {tool.code?.trim() ? (
                <div className='rounded-lg border bg-muted/60 p-3'>
                  <pre className='max-h-64 overflow-auto rounded p-3 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap'>
                    {tool.code}
                  </pre>
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>No code provided for this tool.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function InfoCard({
  label,
  value,
  mutedValue,
}: {
  label: string
  value: ReactNode
  mutedValue?: boolean
}) {
  return (
    <div className='rounded-lg border bg-background p-3'>
      <p className='text-muted-foreground text-xs uppercase tracking-wide'>{label}</p>
      <div
        className={cn(
          'mt-1 text-sm font-medium text-foreground',
          mutedValue && 'text-muted-foreground font-normal'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function DateDisplay({ timestamp }: { timestamp: string }) {
  return (
    <div className='space-y-0.5'>
      <span className='text-foreground text-sm font-medium'>{formatRelativeTime(timestamp)}</span>
      <p className='text-muted-foreground text-xs'>{formatAbsoluteDate(timestamp)}</p>
    </div>
  )
}
