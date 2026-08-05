'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eye, Loader2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { FrozenCanvasModal } from '@/app/workspace/[workspaceId]/records/components/log-details/components/execution-snapshot/frozen-canvas-modal'
import { FileDownload } from '@/app/workspace/[workspaceId]/records/components/log-details/components/file-download/file-download'
import { ToolCallsDisplay } from '@/app/workspace/[workspaceId]/records/components/log-details/components/tool-calls/tool-calls-display'
import { TraceSpans } from '@/app/workspace/[workspaceId]/records/components/log-details/components/trace-spans/trace-spans'
import {
  formatDate,
  getTraceSpanDisplayCostMultiplier,
} from '@/app/workspace/[workspaceId]/records/utils'
import { formatDurationMs, formatFileSize } from '@/i18n/formatters'
import { formatCost } from '@/providers/ai/utils'
import type { WorkflowLog } from '@/stores/logs/filters/types'

interface LogDetailsProps {
  log: WorkflowLog | null
  isOpen: boolean
  busy?: boolean
  stateContent?: ReactNode
  headerControls?: ReactNode
  onClose: () => void
  onNavigateNext?: () => void
  onNavigatePrev?: () => void
  hasNext?: boolean
  hasPrev?: boolean
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
  busy = false,
  stateContent,
  headerControls,
  onClose,
  onNavigateNext,
  onNavigatePrev,
  hasNext = false,
  hasPrev = false,
}: LogDetailsProps) {
  const [isModelsExpanded, setIsModelsExpanded] = useState(false)
  const [isFrozenCanvasOpen, setIsFrozenCanvasOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const t = useTranslations('workspace.logs.details')

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [log?.id])

  const formattedTimestamp = useMemo(() => {
    if (!log) return null
    return formatDate(log.startedAt ?? log.createdAt, locale)
  }, [locale, log?.createdAt, log?.startedAt])

  const formattedDuration = useMemo(() => {
    if (typeof log?.durationMs !== 'number') {
      return null
    }

    return formatDurationMs(locale, log.durationMs)
  }, [locale, log?.durationMs])

  const isWorkflowExecutionLog = useMemo(() => {
    if (!log) return false
    return Boolean(log.executionId)
  }, [log])

  const hasCostInfo = useMemo(() => Boolean(log?.cost), [log])
  const deadlineResult = log?.executionData?.canonicalResult
  const baseExecutionCharge = Number(log?.cost?.baseExecutionCharge || 0)
  const traceSpanCostMultiplier = useMemo(() => {
    if (!log?.executionData?.traceSpans) {
      return 1
    }

    return getTraceSpanDisplayCostMultiplier(log?.executionData?.traceSpans, log?.cost)
  }, [log?.cost, log?.executionData?.traceSpans])

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
      <div className='flex h-full min-h-0 min-w-0 flex-col p-1'>
        <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
          <div
            className='flex h-full min-h-0 items-center justify-center gap-2 p-5 text-center text-muted-foreground text-sm'
            role='status'
            aria-live='polite'
            aria-atomic='true'
            aria-busy={busy || undefined}
          >
            {busy && <Loader2 aria-hidden='true' className='h-4 w-4 animate-spin' />}
            {stateContent ?? (busy ? t('loading') : t('selectLog'))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col p-1'>
      <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
        {/* Header */}
        <div className='z-[9] flex items-center justify-between border-b px-3 py-2'>
          <h2 className='font-medium text-foreground text-sm'>{t('title')}</h2>
          <div className='flex items-center gap-1'>
            {headerControls}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 p-0'
                      onClick={onNavigatePrev}
                      disabled={!hasPrev}
                      aria-label={t('previous')}
                    >
                      <ChevronUp className='h-4 w-4' />
                    </Button>
                  }
                />
                <TooltipContent side='bottom'>{t('previous')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 p-0'
                      onClick={onNavigateNext}
                      disabled={!hasNext}
                      aria-label={t('next')}
                    >
                      <ChevronDown className='h-4 w-4' />
                    </Button>
                  }
                />
                <TooltipContent side='bottom'>{t('next')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7 p-0'
              onClick={onClose}
              aria-label={t('close')}
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className='min-h-0 min-w-0 flex-1'>
          <ScrollArea
            ref={scrollAreaRef}
            className='h-full w-full min-w-0 max-w-full overflow-y-auto'
          >
            <div className='flex w-full min-w-0 max-w-full flex-col gap-3 px-3 pt-4 pb-4'>
              {/* Timestamp & Workflow Row */}
              <div className='flex min-w-0 items-center gap-4'>
                <div className='flex w-full flex-shrink-0 flex-col gap-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('timestamp')}
                  </span>
                  <div className='group relative flex items-center gap-2 pr-8 font-medium text-foreground text-sm'>
                    <span>{formattedTimestamp?.compactDate || t('notAvailable')}</span>
                    <span>{formattedTimestamp?.compactTime || t('notAvailable')}</span>
                  </div>
                </div>

                <div className='flex min-w-0 flex-1 flex-col gap-2'>
                  <span className='font-medium text-muted-foreground text-xs'>{t('workflow')}</span>
                  <div className='group relative flex min-w-0 items-center gap-2 pr-8'>
                    <span
                      className='min-w-0 truncate rounded-sm px-1 font-medium text-foreground text-sm'
                      style={{
                        backgroundColor: `${log.workflow?.color}20`,
                        color: log.workflow?.color,
                      }}
                    >
                      {log.workflow?.name || t('unknownWorkflow')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Execution ID */}
              {log.executionId && (
                <div className='flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('executionId')}
                  </span>
                  <div className='group relative pr-8 font-mono text-foreground text-sm'>
                    <CopyButton text={log.executionId} className='h-5 w-5' showLabel={false} />
                    <span className='block truncate'>{log.executionId}</span>
                  </div>
                </div>
              )}

              {/* Details Section */}
              <div className='-my-1 flex min-w-0 flex-col overflow-hidden rounded-md border'>
                <div className='group relative flex h-12 items-center justify-between border-b px-3'>
                  <span className='font-medium text-muted-foreground text-xs'>{t('level')}</span>
                  <Badge
                    variant={getLevelBadgeVariant(log.level)}
                    className='h-6 rounded-md px-2 text-[11px] capitalize'
                  >
                    {log.level || t('unknownLevel')}
                  </Badge>
                </div>

                <div className='group relative flex h-12 items-center justify-between border-b px-3'>
                  <span className='font-medium text-muted-foreground text-xs'>{t('trigger')}</span>
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
                  <span className='font-medium text-muted-foreground text-xs'>{t('duration')}</span>
                  <span className='font-medium text-foreground text-sm'>
                    {formattedDuration || '—'}
                  </span>
                  {formattedDuration && (
                    <CopyButton text={formattedDuration} className='h-5 w-5' showLabel={false} />
                  )}
                </div>
              </div>

              {deadlineResult?.code === 'WORKFLOW_EXECUTION_TIME_LIMIT_EXCEEDED' && (
                <div className='flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3'>
                  <div className='flex items-center justify-between gap-3'>
                    <span className='font-medium text-destructive text-sm'>
                      {t('deadline.title')}
                    </span>
                    <Badge variant='destructive' className='font-mono text-[10px]'>
                      {deadlineResult.code}
                    </Badge>
                  </div>
                  <p className='text-foreground text-sm'>{t('deadline.reason')}</p>
                  <div className='grid gap-1 text-xs sm:grid-cols-2'>
                    <span className='text-muted-foreground'>
                      {t('deadline.limit', { seconds: deadlineResult.deadline.limitSeconds })}
                    </span>
                    <span className='break-all text-muted-foreground'>
                      {t('deadline.tier', { tierName: deadlineResult.deadline.appliedTierName })}
                    </span>
                  </div>
                </div>
              )}

              {/* Workflow State */}
              {isWorkflowExecutionLog && log.executionId && (
                <div className='flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('workflowState')}
                  </span>
                  <Button
                    variant='secondary'
                    size='sm'
                    onClick={() => setIsFrozenCanvasOpen(true)}
                    className='w-full justify-between px-3'
                  >
                    <span className='font-medium text-xs'>{t('viewSnapshot')}</span>
                    <Eye className='h-4 w-4' />
                  </Button>
                </div>
              )}

              {/* Trace Spans (if available and this is a workflow execution log) */}
              {isWorkflowExecutionLog && log.executionData?.traceSpans && (
                <div className='w-full min-w-0 max-w-full rounded-md border bg-muted/30 px-3 py-2'>
                  <TraceSpans
                    traceSpans={log.executionData.traceSpans}
                    totalDuration={log.durationMs ?? undefined}
                    costMultiplier={traceSpanCostMultiplier}
                  />
                </div>
              )}

              {/* Tool Calls (if available) */}
              {log.executionData?.toolCalls && log.executionData.toolCalls.length > 0 && (
                <div className='flex w-full flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('toolCalls')}
                  </span>
                  <div className='w-full overflow-x-hidden rounded-md bg-background p-3'>
                    <ToolCallsDisplay metadata={log.executionData} />
                  </div>
                </div>
              )}

              {/* Files */}
              {log.files && log.files.length > 0 && (
                <div className='flex w-full flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('files')} ({log.files.length})
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
                            {formatFileSize(locale, file.size, {
                              fallback: t('unknownSize'),
                            })}
                          </span>
                        </div>
                        <div className='flex items-center justify-between gap-2'>
                          <span className='text-[11px] text-muted-foreground'>
                            {file.type || t('unknownType')}
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
                  <span className='font-medium text-muted-foreground text-xs'>
                    {t('costBreakdown')}
                  </span>
                  <div className='overflow-hidden rounded-md border'>
                    <div className='flex flex-col gap-2 p-3'>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>{t('baseExecution')}</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(baseExecutionCharge)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>{t('modelInput')}</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.input || 0)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>{t('modelOutput')}</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.output || 0)}
                        </span>
                      </div>
                    </div>

                    <div className='border-t' />

                    <div className='flex flex-col gap-2 p-3'>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>{t('total')}</span>
                        <span className='text-foreground text-xs'>
                          {formatCost(log.cost?.total || 0)}
                        </span>
                      </div>
                      <div className='flex items-center justify-between'>
                        <span className='text-muted-foreground text-xs'>{t('tokens')}</span>
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
                            {t('modelBreakdown', {
                              count: Object.keys(log.cost?.models || {}).length,
                            })}
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
                                      <span className='text-muted-foreground'>{t('input')}</span>
                                      <span>{formatCost(cost.input || 0)}</span>
                                    </div>
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>{t('output')}</span>
                                      <span>{formatCost(cost.output || 0)}</span>
                                    </div>
                                    <div className='flex justify-between border-t pt-1'>
                                      <span className='text-muted-foreground'>{t('total')}</span>
                                      <span className='font-medium'>
                                        {formatCost(cost.total || 0)}
                                      </span>
                                    </div>
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>{t('tokens')}</span>
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
                        {t('totalCostNote', {
                          amount: formatCost(baseExecutionCharge),
                        })}
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
