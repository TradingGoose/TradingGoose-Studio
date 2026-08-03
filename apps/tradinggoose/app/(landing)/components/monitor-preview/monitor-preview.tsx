'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocale, useMessages } from 'next-intl'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ListingResolved } from '@/lib/listing/identity'
import type { LocaleCode } from '@/i18n/utils'

type MonitorEntry = {
  id: string
  stock: ListingResolved
  indicator: string
  indicatorColor: string
  workflow: string
  workflowColor: string
  status: 'pending' | 'running' | 'success' | 'failed'
}

const INITIAL_STATUSES: MonitorEntry['status'][] = [
  'success',
  'running',
  'success',
  'running',
  'success',
  'pending',
]
const RANDOM_STATUSES: MonitorEntry['status'][] = ['pending', 'pending', 'running']
const INITIAL_ROWS = 6
const MAX_ROWS = 20

type MonitorOption = { name: string; color: string }

function createRandomEntry(
  stocks: ListingResolved[],
  indicators: MonitorOption[],
  workflows: MonitorOption[],
  counter: number
): MonitorEntry {
  const stock = stocks[Math.floor(Math.random() * stocks.length)]
  const indicator = indicators[Math.floor(Math.random() * indicators.length)]
  const workflow = workflows[Math.floor(Math.random() * workflows.length)]

  return {
    id: `entry-${counter}`,
    stock,
    indicator: indicator.name,
    indicatorColor: indicator.color,
    workflow: workflow.name,
    workflowColor: workflow.color,
    status: RANDOM_STATUSES[Math.floor(Math.random() * RANDOM_STATUSES.length)],
  }
}

function advanceStatus(status: MonitorEntry['status']): MonitorEntry['status'] {
  if (status === 'pending') return Math.random() < 0.5 ? 'running' : 'pending'
  if (status === 'running') {
    if (Math.random() < 0.4) return 'success'
    if (Math.random() < 0.08) return 'failed'
    return 'running'
  }
  return status
}

function seedEntries(
  stocks: ListingResolved[],
  indicators: MonitorOption[],
  workflows: MonitorOption[]
): MonitorEntry[] {
  return stocks.slice(0, INITIAL_ROWS).map((stock, index) => {
    const indicator = indicators[index % indicators.length]
    const workflow = workflows[(index * 2) % workflows.length]

    return {
      id: `initial-${index}-${stock.listingIdentity.listing_type}-${stock.listingIdentity.listing_id || stock.listingIdentity.base_id}`,
      stock,
      indicator: indicator.name,
      indicatorColor: indicator.color,
      workflow: workflow.name,
      workflowColor: workflow.color,
      status: INITIAL_STATUSES[index] as MonitorEntry['status'],
    }
  })
}

export default function MonitorPreview({ stocks }: { stocks: ListingResolved[] }) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const monitorCopy = copy.landing.monitorSection
  const [liveStocks, setLiveStocks] = useState(stocks)
  const [entries, setEntries] = useState<MonitorEntry[]>(() =>
    seedEntries(stocks, monitorCopy.indicatorOptions, monitorCopy.workflowOptions)
  )
  const statusConfig: Record<
    MonitorEntry['status'],
    { label: string; className: string; dotClassName: string }
  > = {
    pending: {
      label: monitorCopy.statuses.pending,
      className: 'bg-muted text-muted-foreground',
      dotClassName: 'bg-muted-foreground/60',
    },
    running: {
      label: monitorCopy.statuses.running,
      className: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
      dotClassName: 'bg-blue-500',
    },
    success: {
      label: monitorCopy.statuses.success,
      className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
      dotClassName: 'bg-emerald-500',
    },
    failed: {
      label: monitorCopy.statuses.failed,
      className: 'bg-destructive/15 text-destructive border-destructive/20',
      dotClassName: 'bg-destructive',
    },
  }

  useEffect(() => {
    setLiveStocks(stocks)
  }, [stocks])

  useEffect(() => {
    setEntries(seedEntries(liveStocks, monitorCopy.indicatorOptions, monitorCopy.workflowOptions))
  }, [liveStocks, monitorCopy.indicatorOptions, monitorCopy.workflowOptions])

  useEffect(() => {
    if (liveStocks.length === 0) return

    let timeoutId: ReturnType<typeof setTimeout>

    const tick = () => {
      setEntries((prev) => {
        const updated = prev.map((entry) => ({
          ...entry,
          status: advanceStatus(entry.status),
        }))
        const nextEntries = [
          createRandomEntry(
            liveStocks,
            monitorCopy.indicatorOptions,
            monitorCopy.workflowOptions,
            Date.now()
          ),
          ...updated,
        ]
        return nextEntries.slice(0, MAX_ROWS)
      })

      timeoutId = setTimeout(tick, 1500 + Math.random() * 5500)
    }

    timeoutId = setTimeout(tick, 1500 + Math.random() * 5500)
    return () => clearTimeout(timeoutId)
  }, [liveStocks])

  return (
    <div className='relative max-h-[420px] w-full overflow-hidden rounded-lg border bg-background/50 backdrop-blur-sm'>
      <div className='pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-1/3 bg-gradient-to-t from-background to-transparent' />
      <Table className='table-fixed'>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            <TableHead className='w-[14rem] max-sm:w-[3rem] max-sm:px-2'>
              {monitorCopy.tableHeaders.listing}
            </TableHead>
            <TableHead className='w-[10rem] max-sm:w-auto max-sm:px-2'>
              {monitorCopy.tableHeaders.indicator}
            </TableHead>
            <TableHead className='w-[12rem] max-sm:w-auto max-sm:px-2'>
              {monitorCopy.tableHeaders.workflow}
            </TableHead>
            <TableHead className='w-[6rem] text-right max-sm:w-[3rem] max-sm:px-2'>
              {monitorCopy.tableHeaders.status}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const currentStatusConfig = statusConfig[entry.status]

              return (
                <motion.tr
                  key={entry.id}
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className='border-b transition-colors hover:bg-muted/50'
                >
                  <TableCell className='min-w-0 max-sm:w-10 max-sm:px-2 max-sm:[&_.flex-col]:hidden'>
                    <MarketListingRow listing={entry.stock} className='w-full min-w-0 pr-0' />
                  </TableCell>
                  <TableCell className='min-w-0 max-w-[7rem] max-sm:max-w-[5rem] max-sm:px-2'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: entry.indicatorColor }}
                      />
                      <span className='min-w-0 truncate text-muted-foreground text-sm'>
                        {entry.indicator}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className='min-w-0 max-w-[8rem] max-sm:max-w-[5rem] max-sm:px-2'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: entry.workflowColor }}
                      />
                      <span className='min-w-0 truncate text-muted-foreground text-sm'>
                        {entry.workflow}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className='text-right max-sm:px-2'>
                    <span
                      className={`inline-block size-2.5 shrink-0 rounded-full sm:hidden ${currentStatusConfig.dotClassName}`}
                      aria-label={currentStatusConfig.label}
                      title={currentStatusConfig.label}
                    />
                    <Badge
                      variant='outline'
                      className={`hidden text-xs sm:inline-flex ${currentStatusConfig.className}`}
                    >
                      {currentStatusConfig.label}
                    </Badge>
                  </TableCell>
                </motion.tr>
              )
            })}
          </AnimatePresence>
        </TableBody>
      </Table>
    </div>
  )
}
