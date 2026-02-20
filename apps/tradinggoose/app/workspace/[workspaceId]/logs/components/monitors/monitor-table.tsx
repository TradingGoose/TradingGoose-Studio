'use client'
import { MoreHorizontal, Pause, Play, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  StreamingProviderOption,
  WorkflowTargetOption,
} from './types'
import { formatListingLabel } from './utils'

type MonitorTableProps = {
  monitors: IndicatorMonitorRecord[]
  monitorsLoading: boolean
  referenceLoading: boolean
  monitorsError: string | null
  selectedMonitorId: string | null
  togglingMonitorId: string | null
  deletingMonitorId: string | null
  providerOptionById: Map<string, StreamingProviderOption>
  workflowTargetByKey: Map<string, WorkflowTargetOption>
  indicatorOptionById: Map<string, IndicatorOption>
  onSelectMonitor: (monitorId: string) => void
  onBeginEditMonitor: (monitor: IndicatorMonitorRecord) => void
  onToggleMonitorState: (monitor: IndicatorMonitorRecord) => void
  onRemoveMonitor: (monitorId: string) => void
}

export function MonitorTable({
  monitors,
  monitorsLoading,
  referenceLoading,
  monitorsError,
  selectedMonitorId,
  togglingMonitorId,
  deletingMonitorId,
  providerOptionById,
  workflowTargetByKey,
  indicatorOptionById,
  onSelectMonitor,
  onBeginEditMonitor,
  onToggleMonitorState,
  onRemoveMonitor,
}: MonitorTableProps) {
  return (
    <div className='flex h-full max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
      <div className='h-full max-h-full min-h-0 overflow-auto'>
        {monitorsLoading || referenceLoading ? (
          <div className='flex h-full items-center justify-center gap-2 text-muted-foreground text-sm'>
            Loading monitors...
          </div>
        ) : monitorsError ? (
          <div className='flex h-full items-center justify-center gap-2 px-4 text-destructive text-sm'>
            {monitorsError}
          </div>
        ) : (
          <table className='w-full table-fixed'>
            <thead className='sticky top-0 z-10 border-b bg-card'>
              <tr>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Provider
                </th>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Auth
                </th>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Listing
                </th>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Indicator
                </th>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Workflow
                </th>
                <th className='px-3 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase'>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {monitors.length === 0 ? (
                <tr>
                  <td colSpan={6} className='px-4 py-6 text-center text-muted-foreground text-sm'>
                    No monitors configured.
                  </td>
                </tr>
              ) : (
                monitors.map((monitor) => {
                  const providerOption = providerOptionById.get(
                    monitor.providerConfig.monitor.providerId
                  )
                  const ProviderIcon = providerOption?.icon
                  const target = workflowTargetByKey.get(`${monitor.workflowId}:${monitor.blockId}`)
                  const indicator = indicatorOptionById.get(
                    monitor.providerConfig.monitor.indicatorId
                  )
                  const auth = monitor.providerConfig.monitor.auth
                  const authConfigured = Boolean(auth?.hasEncryptedSecrets)
                  const isSelected = selectedMonitorId === monitor.monitorId

                  return (
                    <tr
                      key={monitor.monitorId}
                      className={`border-b transition-colors ${
                        isSelected ? 'bg-accent/40' : 'hover:bg-accent/20'
                      }`}
                      onClick={() => onSelectMonitor(monitor.monitorId)}
                    >
                      <td className='px-3 py-3'>
                        <div className='flex items-center gap-2'>
                          {ProviderIcon ? <ProviderIcon className='h-4 w-4' /> : null}
                          <span className='truncate text-sm'>
                            {providerOption?.name || monitor.providerConfig.monitor.providerId}
                          </span>
                          {!monitor.isActive ? (
                            <Badge
                              variant='secondary'
                              className='h-5 rounded-md px-1.5 text-[10px]'
                            >
                              Paused
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className='px-3 py-3'>
                        <Badge
                          variant={authConfigured ? 'default' : 'secondary'}
                          className='h-6 rounded-md px-2 text-[11px]'
                        >
                          {authConfigured ? 'Configured' : 'Missing'}
                        </Badge>
                      </td>
                      <td className='px-3 py-3'>
                        <div className='truncate text-sm'>
                          {formatListingLabel(monitor.providerConfig.monitor.listing)}
                        </div>
                      </td>
                      <td className='px-3 py-3'>
                        <div className='truncate text-sm'>
                          {indicator?.name || monitor.providerConfig.monitor.indicatorId}
                        </div>
                        <div className='text-[11px] text-muted-foreground'>
                          {indicator?.source === 'custom' ? 'Custom' : 'Default'}
                        </div>
                        <div className='mt-1'>
                          <Badge variant='outline' className='h-5 rounded-md px-1.5 text-[10px]'>
                            {monitor.providerConfig.monitor.interval}
                          </Badge>
                        </div>
                      </td>
                      <td className='px-3 py-3'>
                        <div className='truncate text-sm'>
                          {target?.workflowName || monitor.workflowId}
                        </div>
                      </td>
                      <td className='px-3 py-3 text-right'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8'
                              onClick={(event) => {
                                event.stopPropagation()
                              }}
                            >
                              <MoreHorizontal className='h-4 w-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={(event) => {
                                event.preventDefault()
                                onBeginEditMonitor(monitor)
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={togglingMonitorId === monitor.monitorId}
                              onClick={(event) => {
                                event.preventDefault()
                                onToggleMonitorState(monitor)
                              }}
                            >
                              {monitor.isActive ? (
                                <>
                                  <Pause className='mr-2 h-4 w-4' />
                                  Pause
                                </>
                              ) : (
                                <>
                                  <Play className='mr-2 h-4 w-4' />
                                  Activate
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={deletingMonitorId === monitor.monitorId}
                              className='text-destructive focus:text-destructive'
                              onClick={(event) => {
                                event.preventDefault()
                                onRemoveMonitor(monitor.monitorId)
                              }}
                            >
                              <Trash2 className='mr-2 h-4 w-4' />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
