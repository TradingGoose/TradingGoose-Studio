'use client'

import type { RefObject } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getLogLevelOption,
  getLogTriggerColor,
  getLogTriggerOption,
} from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/shared'
import Timeline from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/timeline'
import { formatDate } from '@/app/workspace/[workspaceId]/records/utils'
import { formatDurationMs } from '@/i18n/formatters'
import type { WorkflowLog } from '@/stores/logs/filters/types'

export interface LogsListProps {
  logs: WorkflowLog[]
  selectedLogId: string | null
  onLogClick: (log: WorkflowLog) => void
  loading: boolean
  error: string | null
  hasMore: boolean
  isFetchingMore: boolean
  loaderRef: RefObject<HTMLDivElement | null>
  scrollContainerRef: RefObject<HTMLDivElement | null>
  selectedRowRef: RefObject<HTMLTableRowElement | null>
}

export function LogsList({
  logs,
  selectedLogId,
  onLogClick,
  loading,
  error,
  hasMore,
  isFetchingMore,
  loaderRef,
  scrollContainerRef,
  selectedRowRef,
}: LogsListProps) {
  const locale = useLocale()
  const t = useTranslations('workspace.logs.list')
  const tFilters = useTranslations('workspace.logs.dashboard.filters')
  return (
    <div className='flex h-full max-h-full min-h-0 min-w-0 flex-1 overflow-hidden'>
      <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <div className=' sm:hidden'>
          <TooltipProvider>
            <Timeline />
          </TooltipProvider>
        </div>

        <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
          <div className='h-full max-h-full min-h-0 w-full overflow-x-auto'>
            <div className='h-full max-h-full min-h-0 min-w-0'>
              <div className='flex h-full max-h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
                <div className='shrink-0 border-b bg-card/40'>
                  <Table className='w-full table-auto'>
                    <colgroup>
                      <col className='w-[20%]' />
                      <col className='w-[15%]' />
                      <col className='w-[25%]' />
                      <col className='w-[20%]' />
                      <col className='hidden xl:table-column' />
                      <col className='hidden xl:table-column' />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.time')}
                          </span>
                        </TableHead>
                        <TableHead className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.status')}
                          </span>
                        </TableHead>
                        <TableHead className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.workflow')}
                          </span>
                        </TableHead>
                        <TableHead className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.cost')}
                          </span>
                        </TableHead>
                        <TableHead className='hidden px-4 pt-2 pb-3 text-center align-middle font-medium xl:table-cell'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.trigger')}
                          </span>
                        </TableHead>
                        <TableHead className='hidden px-4 pt-2 pb-3 text-center align-middle font-medium xl:table-cell'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            {t('headers.duration')}
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                  </Table>
                </div>

                <div
                  className='h-full max-h-full min-h-0 flex-1 overflow-auto'
                  ref={scrollContainerRef}
                  style={{ scrollbarGutter: 'stable' }}
                >
                  {loading ? (
                    <div className='flex h-full items-center justify-center p-5'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Loader2 className='h-5 w-5 animate-spin' />
                        <span className='text-sm'>{t('loading')}</span>
                      </div>
                    </div>
                  ) : error ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-destructive'>
                        <AlertCircle className='h-5 w-5' />
                        <span className='text-sm'>
                          {t('errorPrefix')}
                          {error}
                        </span>
                      </div>
                    </div>
                  ) : logs.length === 0 ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Info className='h-5 w-5' />
                        <span className='text-sm'>{t('noLogs')}</span>
                      </div>
                    </div>
                  ) : (
                    <Table className='w-full table-auto'>
                      <colgroup>
                        <col className='w-[20%]' />
                        <col className='w-[15%]' />
                        <col className='w-[25%]' />
                        <col className='w-[20%]' />
                        <col className='hidden xl:table-column' />
                        <col className='hidden xl:table-column' />
                      </colgroup>
                      <TableBody>
                        {logs.map((log) => {
                          const formattedDate = formatDate(log.startedAt ?? log.createdAt, locale)
                          const isSelected = selectedLogId === log.id
                          const levelOption = getLogLevelOption(log.level)
                          const triggerOption = getLogTriggerOption(log.trigger)

                          return (
                            <TableRow
                              key={log.id}
                              ref={isSelected ? selectedRowRef : null}
                              className={cn(
                                'cursor-pointer border-b transition-colors hover:bg-card/30',
                                isSelected && 'selected-row bg-accent'
                              )}
                              onClick={() => onLogClick(log)}
                            >
                              <TableCell className='px-4 py-3 text-center align-middle'>
                                <div className='text-[13px]'>
                                  <span className='font-sm text-muted-foreground'>
                                    {formattedDate.compactDate}
                                  </span>
                                  <span
                                    className='hidden font-medium sm:inline'
                                    style={{ marginLeft: '8px' }}
                                  >
                                    {formattedDate.compactTime}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className='px-4 py-3 text-center align-middle'>
                                <div
                                  className={cn(
                                    'inline-flex items-center rounded-sm px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                    log.level === 'error'
                                      ? 'bg-red-500 text-white'
                                      : 'bg-secondary text-card-foreground'
                                  )}
                                >
                                  {levelOption ? tFilters(levelOption.labelKey) : log.level}
                                </div>
                              </TableCell>
                              <TableCell className='px-4 py-3 text-center align-middle'>
                                <div className='truncate font-medium text-[13px]'>
                                  {log.workflow?.name || t('unknownWorkflow')}
                                </div>
                              </TableCell>
                              <TableCell className='px-4 py-3 text-center align-middle'>
                                <div className='font-medium text-muted-foreground text-xs'>
                                  {typeof (log as any)?.cost?.total === 'number'
                                    ? `$${((log as any).cost.total as number).toFixed(4)}`
                                    : '—'}
                                </div>
                              </TableCell>
                              <TableCell className='hidden px-4 py-3 text-center align-middle xl:table-cell'>
                                {log.trigger ? (
                                  <div
                                    className={cn(
                                      'inline-flex items-center rounded-sm px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                      log.trigger.toLowerCase() === 'manual'
                                        ? 'bg-secondary text-card-foreground'
                                        : 'text-white'
                                    )}
                                    style={
                                      log.trigger.toLowerCase() === 'manual'
                                        ? undefined
                                        : { backgroundColor: getLogTriggerColor(log.trigger) }
                                    }
                                  >
                                    {triggerOption ? tFilters(triggerOption.labelKey) : log.trigger}
                                  </div>
                                ) : (
                                  <div className='text-muted-foreground text-xs'>—</div>
                                )}
                              </TableCell>
                              <TableCell className='hidden px-4 py-3 text-center align-middle text-muted-foreground text-xs xl:table-cell'>
                                {typeof log.durationMs === 'number'
                                  ? formatDurationMs(locale, log.durationMs)
                                  : '—'}
                              </TableCell>
                            </TableRow>
                          )
                        })}

                        {hasMore && (
                          <TableRow>
                            <TableCell colSpan={6} className='px-4 py-4 text-center align-middle'>
                              <div
                                ref={loaderRef}
                                className='flex items-center justify-center gap-2 text-muted-foreground'
                              >
                                {isFetchingMore ? (
                                  <>
                                    <Loader2 className='h-4 w-4 animate-spin' />
                                    <span className='text-sm'>{t('loadingMore')}</span>
                                  </>
                                ) : (
                                  <span className='text-sm'>{t('scrollToLoadMore')}</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
