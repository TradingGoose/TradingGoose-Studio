'use client'
import {
  Activity,
  MoreHorizontal,
  Pause,
  Play,
  Pen,
  Trash2,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ListingOption } from '@/lib/listing/identity'
import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  StreamingProviderOption,
  WorkflowTargetOption,
} from './types'

type MonitorListingValue = IndicatorMonitorRecord['providerConfig']['monitor']['listing'] & {
  base?: string
  quote?: string | null
  name?: string | null
  iconUrl?: string | null
  assetClass?: string | null
  countryCode?: string | null
}

const toListingOption = (
  listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing']
): ListingOption | null => {
  const value = listing as MonitorListingValue
  const identityBase =
    value.listing_type === 'default' ? value.listing_id?.trim() : value.base_id?.trim()
  const identityQuote = value.listing_type === 'default' ? '' : value.quote_id?.trim()
  const base = (typeof value.base === 'string' ? value.base.trim() : '') || identityBase || ''
  if (!base) return null

  const quote = (typeof value.quote === 'string' ? value.quote.trim() : '') || identityQuote || ''

  return {
    ...listing,
    base,
    quote: quote || null,
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : null,
    iconUrl: typeof value.iconUrl === 'string' ? value.iconUrl : null,
    assetClass: typeof value.assetClass === 'string' ? value.assetClass : null,
    countryCode: typeof value.countryCode === 'string' ? value.countryCode : null,
  }
}

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
    <div className='m-1 flex h-full max-h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
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
          <table className='w-full table-auto'>
            <thead className='sticky top-0 z-10 border-b bg-card'>
              <tr>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Status</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Provider</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Auth</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Listing</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Indicator</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Workflow</span>
                </th>
                <th className='px-4 pt-2 pb-3 text-center align-middle font-medium'>
                  <span className='text-muted-foreground text-xs leading-none'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {monitors.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className='px-4 py-6 text-center align-middle text-muted-foreground text-sm'
                  >
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
                  const workflowColor = target?.workflowColor ?? '#64748b'
                  const indicatorColor = indicator?.color ?? '#64748b'
                  const auth = monitor.providerConfig.monitor.auth
                  const authConfigured = Boolean(auth?.hasEncryptedSecrets)
                  const isSelected = selectedMonitorId === monitor.monitorId
                  const listingOption = toListingOption(monitor.providerConfig.monitor.listing)

                  return (
                    <tr
                      key={monitor.monitorId}
                      className={`border-b transition-colors ${isSelected ? 'bg-accent/40' : 'hover:bg-accent/20'
                        }`}
                      onClick={() => onSelectMonitor(monitor.monitorId)}
                    >
                      <td className='p-3 text-center align-middle'>
                        <Badge
                          className={`h-6 items-center justify-center rounded-md px-2 text-[11px] ${monitor.isActive
                            ? 'bg-green-500/20 text-green-500'
                            : 'bg-gray-500/20 text-gray-500'
                            }`}
                        >
                          {monitor.isActive ? 'Active' : 'Paused'}
                        </Badge>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <div className='flex items-center justify-center gap-2'>
                          {ProviderIcon ? <ProviderIcon className='h-6 w-6' /> : null}
                          <span className='truncate text-sm'>
                            {providerOption?.name || monitor.providerConfig.monitor.providerId}
                          </span>
                        </div>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <Badge
                          variant={authConfigured ? 'default' : 'secondary'}
                          className='h-6 items-center justify-center rounded-md px-2 text-[11px]'
                        >
                          {authConfigured ? 'Configured' : 'Missing'}
                        </Badge>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <div className='flex items-center'>
                          <MarketListingRow
                            listing={listingOption}
                            showAssetClass
                            className='w-full pl-1 rounded-md border border-border'
                            placeholderTitle='Listing'
                          />
                        </div>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <div className='flex flex-col-2 items-center justify-center gap-1'>
                          <div className='flex items-center justify-center gap-2'>
                            <span
                              className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                              style={{ backgroundColor: `${indicatorColor}20` }}
                              aria-hidden='true'
                            >
                              <Activity
                                className='h-full w-full'
                                style={{ color: indicatorColor }}
                              />
                            </span>
                            <div className='truncate text-sm'>
                              {indicator?.name || monitor.providerConfig.monitor.indicatorId}
                            </div>
                          </div>
                          <Badge variant='outline' className='h-5 rounded-md px-1.5 text-[10px]'>
                            {monitor.providerConfig.monitor.interval}
                          </Badge>
                        </div>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <div className='flex items-center justify-center gap-2'>
                          <span
                            className='h-5 w-5 shrink-0 rounded-xs p-0.5'
                            style={{ backgroundColor: `${workflowColor}20` }}
                            aria-hidden='true'
                          >
                            <WorkflowIcon
                              className='h-full w-full'
                              style={{ color: workflowColor }}
                            />
                          </span>
                          <div className='truncate text-sm'>
                            {target?.workflowName || monitor.workflowId}
                          </div>
                        </div>
                      </td>
                      <td className='p-3 text-center align-middle'>
                        <div className='flex items-center justify-center'>
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
                                <Pen className='mr-2 h-4 w-4' />
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
                        </div>
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
