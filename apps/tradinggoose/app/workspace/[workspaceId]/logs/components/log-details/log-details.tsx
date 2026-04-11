'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FrozenCanvasModal } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/execution-snapshot/frozen-canvas-modal'
import { FileDownload } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/file-download/file-download'
import { ToolCallsDisplay } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/tool-calls/tool-calls-display'
import { TraceSpans } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/trace-spans/trace-spans'
import {
  formatDate,
  getTraceSpanDisplayCostMultiplier,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { formatCost } from '@/providers/ai/utils'
import type { WorkflowLog } from '@/stores/logs/filters/types'

interface LogDetailsProps {
  log: WorkflowLog | null
  isOpen: boolean
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
}

const formatFileSize = (bytes?: number | null): string => {
  if (bytes === null || bytes === undefined) return 'Unknown size'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

const getLevelBadgeVariant = (level?: string | null) => {
  const normalized = level?.toLowerCase()
  if (normalized === 'error' || normalized === 'fatal') return 'destructive'
  if (normalized === 'warn' || normalized === 'warning') return 'secondary'
  return 'secondary'
}

export function LogDetails({
  log,
  isOpen,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
}: LogDetailsProps) {
  const [isModelsExpanded, setIsModelsExpanded] = useState(false)
  const [isFrozenCanvasOpen, setIsFrozenCanvasOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const isLoadingDetails = useMemo(() => {
    if (!log) return false
    // Only show while we expect details to arrive (has executionId)
    if (!log.executionId) return false
    const hasEnhanced = !!log.executionData?.enhanced
    const hasAnyDetails = hasEnhanced || !!log.cost || Array.isArray(log.executionData?.traceSpans)
    return !hasAnyDetails
  }, [log])

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log?.id])

  const formattedTimestamp = useMemo(() => {
    if (!log) return null
    return formatDate(log.createdAt)
  }, [log?.createdAt])

  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    return (
      (log.trigger === 'manual' && !!log.duration) ||
      (log.executionData?.enhanced && log.executionData?.traceSpans)
    )
  }, [log])

  const hasCostInfo = useMemo(
    () => Boolean(isWorkflowExecutionLog && log?.cost),
    [log, isWorkflowExecutionLog]
  )
  const baseExecutionCharge = Number(log?.cost?.baseExecutionCharge || 0)
  const traceSpanCostMultiplier = useMemo(() => {
    if (!isWorkflowExecutionLog) {
      return 1
    }

    return getTraceSpanDisplayCostMultiplier(log?.executionData?.traceSpans, log?.cost)
  }, [isWorkflowExecutionLog, log?.cost, log?.executionData?.traceSpans])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }

      if (isOpen) {
        if (e.key === 'ArrowUp' && hasPrev && onNavigatePrev) {
          e.preventDefault()
          onNavigatePrev()
        }

        if (e.key === 'ArrowDown' && hasNext && onNavigateNext) {
          e.preventDefault()
          onNavigateNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, hasPrev, hasNext, onNavigatePrev, onNavigateNext])

  if (!isOpen) {
    return null
  }

  if (!log) {
    return (
      <div className='flex h-full min-h-0 min-w-0 items-center justify-center text-muted-foreground text-sm'>
        Select a log to view details
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col p-1'>
      <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
        {/* Header */}
        <div className='z-[9] flex items-center justify-between border-b px-3 py-2'>
          <h2 className='font-medium text-foreground text-sm'>Log Details</h2>
          <div className='flex items-center gap-1'>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 p-0'
                    onClick={onNavigatePrev}
                    disabled={!hasPrev}
                    aria-label='Previous log'
                  >
                    <ChevronUp className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom'>Previous log</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7 p-0'
                    onClick={onNavigateNext}
                    disabled={!hasNext}
                    aria-label='Next log'
                  >
                    <ChevronDown className='h-4 w-4' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom'>Next log</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7 p-0'
              onClick={onClose}
              aria-label='Close'
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className='min-h-0 flex-1'>
          <ScrollArea ref={scrollAreaRef} className='h-full w-full overflow-y-auto'>
            <div className='flex w-full flex-col gap-3 px-3 pt-4 pb-4'>
              {/* Timestamp & Workflow Row */}
              <div className='flex min-w-0 items-center gap-4'>
                <div className='flex w-[140px] flex-shrink-0 flex-col gap-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Timestamp</span>
                  <div className='group relative flex items-center gap-2 pr-8 font-medium text-foreground text-sm'>
                    <span>{formattedTimestamp?.compactDate || 'N/A'}</span>
                    <span>{formattedTimestamp?.compactTime || 'N/A'}</span>
                  </div>
                </div>

                <div className='flex min-w-0 flex-1 flex-col gap-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Workflow</span>
                  <div className='group relative flex min-w-0 items-center gap-2 pr-8'>
                    <span
                      className='min-w-0 truncate rounded-sm px-1 font-medium text-foreground text-sm'
                      style={{
                        backgroundColor: `${log.workflow?.color}20`,
                        color: log.workflow?.color,
                      }}
                    >
                      {log.workflow?.name || 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Execution ID */}
              {log.executionId && (
                <div className='flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Execution ID</span>
                  <div className='group relative pr-8 font-mono text-foreground text-sm'>
                    <CopyButton text={log.executionId} className='h-5 w-5' showLabel={false} />
                    <span className='block truncate'>{log.executionId}</span>
                  </div>
                </div>
              )}

              {/* Details Section */}
              <div className='-my-1 flex min-w-0 flex-col overflow-hidden rounded-md border'>
                <div className='group relative flex h-12 items-center justify-between border-b px-3'>
                  <span className='font-medium text-muted-foreground text-xs'>Level</span>
                  <Badge
                    variant={getLevelBadgeVariant(log.level)}
                    className='h-6 rounded-md px-2 text-[11px] capitalize'
                  >
                    {log.level || 'unknown'}
                  </Badge>
                </div>

                <div className='group relative flex h-12 items-center justify-between border-b px-3'>
                  <span className='font-medium text-muted-foreground text-xs'>Trigger</span>
                  {log.trigger ? (
                    <>
                      <Badge
                        variant='secondary'
                        className='h-6 rounded-md px-2 text-[11px] capitalize'
                      >
                        {log.trigger}
                      </Badge>
                    </>
                  ) : (
                    <span className='font-medium text-muted-foreground text-xs'>—</span>
                  )}
                </div>

                <div className='group relative flex h-12 items-center justify-between px-3 pr-8'>
                  <span className='font-medium text-muted-foreground text-xs'>Duration</span>
                  <span className='font-medium text-foreground text-sm'>{log.duration || '—'}</span>
                  {log.duration && (
                    <CopyButton text={log.duration} className='h-5 w-5' showLabel={false} />
                  )}
                </div>
              </div>

              {/* Suspense while details load */}
              {isLoadingDetails && (
                <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  <span className='text-xs'>Loading details…</span>
                </div>
              )}

              {/* Workflow State */}
              {isWorkflowExecutionLog && log.executionId && (
                <div className='flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Workflow State</span>
                  <Button
                    variant='secondary'
                    size='sm'
                    onClick={() => setIsFrozenCanvasOpen(true)}
                    className='w-full justify-between px-3'
                  >
                    <span className='font-medium text-xs'>View Snapshot</span>
                    <Eye className='h-4 w-4' />
                  </Button>
                </div>
              )}

              {/* Trace Spans (if available and this is a workflow execution log) */}
              {isWorkflowExecutionLog && log.executionData?.traceSpans && (
                <div className='w-full rounded-md border bg-muted/30 px-3 py-2'>
                  <div className='w-full overflow-x-hidden'>
                    <TraceSpans
                      traceSpans={log.executionData.traceSpans}
                      totalDuration={log.executionData.totalDuration}
                      costMultiplier={traceSpanCostMultiplier}
                    />
                  </div>
                </div>
              )}

              {/* Tool Calls (if available) */}
              {log.executionData?.toolCalls && log.executionData.toolCalls.length > 0 && (
                <div className='flex w-full flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Tool Calls</span>
                  <div className='w-full overflow-x-hidden rounded-md bg-background p-3'>
                    <ToolCallsDisplay metadata={log.executionData} />
                  </div>
                </div>
              )}

              {/* Files */}
              {log.files && log.files.length > 0 && (
                <div className='flex w-full flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    Files ({log.files.length})
                  </span>
                  <div className='flex flex-col gap-2'>
                    {log.files.map((file, index) => (
                      <div
                        key={file.id || index}
                        className='flex flex-col gap-2 rounded-md bg-background px-3 py-2'
                      >
                        <div className='flex items-center justify-between gap-2'>
                          <span className='min-w-0 truncate font-medium text-foreground text-xs'>
                            {file.name}
                          </span>
                          <span className='flex-shrink-0 text-muted-foreground text-xs'>
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='text-[11px] text-muted-foreground'>
                            {file.type || 'Unknown type'}
                          </span>
                          <FileDownload
                            file={file}
                            isExecutionFile={true}
                            className='!h-6 !px-2 text-[11px]'
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost Information (moved to bottom) */}
              {hasCostInfo && (
                <div className='flex flex-col gap-2'>
                  <span className='font-medium text-muted-foreground text-xs'>Cost Breakdown</span>
                  <div className='overflow-hidden rounded-md border'>
                    <div className='flex flex-col gap-2 p-3'>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Base Execution:</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(baseExecutionCharge)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Model Input:</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.input || 0)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Model Output:</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.output || 0)}
                        </span>
                      </div>
                    </div>

                    <div className='border-t' />

                    <div className='flex flex-col gap-2 p-3'>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Total:</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.total || 0)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>Tokens:</span>
                        <span className='text-muted-foreground text-xs'>
                          {log.cost?.tokens?.prompt || 0} in / {log.cost?.tokens?.completion || 0}{' '}
                          out
                        </span>
                      </div>
                    </div>

                    {/* Models Breakdown */}
                    {log.cost?.models && Object.keys(log.cost?.models).length > 0 && (
                      <div className='border-t'>
                        <button
                          onClick={() => setIsModelsExpanded(!isModelsExpanded)}
                          className='flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/40'
                        >
                          <span className='font-medium text-muted-foreground text-xs'>
                            Model Breakdown ({Object.keys(log.cost?.models || {}).length})
                          </span>
                          {isModelsExpanded ? (
                            <ChevronUp className='h-3 w-3 text-muted-foreground' />
                          ) : (
                            <ChevronDown className='h-3 w-3 text-muted-foreground' />
                          )}
                        </button>

                        {isModelsExpanded && (
                          <div className='space-y-3 border-t bg-muted/30 p-3'>
                            {Object.entries(log.cost?.models || {}).map(
                              ([model, cost]: [string, any]) => (
                                <div key={model} className='space-y-1'>
                                  <div className='font-medium font-mono text-xs'>{model}</div>
                                  <div className='space-y-1 text-xs'>
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>Input:</span>
                                      <span>{formatCost(cost.input || 0)}</span>
                                    </div>
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>Output:</span>
                                      <span>{formatCost(cost.output || 0)}</span>
                                    </div>
                                    <div className='flex justify-between border-t pt-1'>
                                      <span className='text-muted-foreground'>Total:</span>
                                      <span className='font-medium'>
                                        {formatCost(cost.total || 0)}
                                      </span>
                                    </div>
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>Tokens:</span>
                                      <span>
                                        {cost.tokens?.prompt || 0} in /{' '}
                                        {cost.tokens?.completion || 0} out
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className='border-t bg-muted/40 p-2 text-[11px] text-muted-foreground'>
                      <p>
                        Total cost includes a base execution charge of{' '}
                        {formatCost(baseExecutionCharge)} plus any model usage costs.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        {/* Frozen Canvas Modal */}
        {log.executionId && (
          <FrozenCanvasModal
            executionId={log.executionId}
            workflowName={log.workflow?.name}
            trigger={log.trigger || undefined}
            traceSpans={log.executionData?.traceSpans}
            costMultiplier={traceSpanCostMultiplier}
            isOpen={isFrozenCanvasOpen}
            onClose={() => setIsFrozenCanvasOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
