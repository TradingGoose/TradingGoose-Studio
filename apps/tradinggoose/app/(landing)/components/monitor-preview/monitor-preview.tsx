'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
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
import type { ListingOption } from '@/lib/listing/identity'

type MonitorEntry = {
  id: string
  stock: ListingOption
  indicator: string
  indicatorColor: string
  workflow: string
  workflowColor: string
  status: 'pending' | 'running' | 'success' | 'failed'
}

const INDICATORS = [
  { name: 'RSI < 30', color: '#8b5cf6' },
  { name: 'MACD Cross', color: '#14b8a6' },
  { name: 'EMA 21/50', color: '#f59e0b' },
  { name: 'Supertrend', color: '#ef4444' },
  { name: 'BB Squeeze', color: '#3b82f6' },
  { name: 'Volume Spike', color: '#10b981' },
]

const WORKFLOWS = [
  { name: 'Sentiment Analysis', color: '#6366f1' },
  { name: 'Risk Assessment', color: '#f59e0b' },
  { name: 'Portfolio Rebalance', color: '#22c55e' },
  { name: 'Earnings Report Check', color: '#3b82f6' },
  { name: 'Social Media Scan', color: '#8b5cf6' },
  { name: 'Volatility Analysis', color: '#ef4444' },
  { name: 'Sector Correlation', color: '#14b8a6' },
]

const STATUS_CONFIG: Record<
  MonitorEntry['status'],
  { label: string; className: string; dotClassName: string }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-muted text-muted-foreground',
    dotClassName: 'bg-muted-foreground/60',
  },
  running: {
    label: 'Running',
    className: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
    dotClassName: 'bg-blue-500',
  },
  success: {
    label: 'Success',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
    dotClassName: 'bg-emerald-500',
  },
  failed: {
    label: 'Failed',
    className: 'bg-destructive/15 text-destructive border-destructive/20',
    dotClassName: 'bg-destructive',
  },
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

function createRandomEntry(stocks: ListingOption[], counter: number): MonitorEntry {
  const stock = stocks[Math.floor(Math.random() * stocks.length)]
  const indicator = INDICATORS[Math.floor(Math.random() * INDICATORS.length)]
  const workflow = WORKFLOWS[Math.floor(Math.random() * WORKFLOWS.length)]

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

function seedEntries(stocks: ListingOption[]): MonitorEntry[] {
  return stocks.slice(0, INITIAL_ROWS).map((stock, index) => {
    const indicator = INDICATORS[index % INDICATORS.length]
    const workflow = WORKFLOWS[(index * 2) % WORKFLOWS.length]

    return {
      id: `initial-${index}-${stock.listing_type}-${stock.listing_id || stock.base_id}`,
      stock,
      indicator: indicator.name,
      indicatorColor: indicator.color,
      workflow: workflow.name,
      workflowColor: workflow.color,
      status: INITIAL_STATUSES[index] as MonitorEntry['status'],
    }
  })
}

export default function MonitorPreview({ stocks }: { stocks: ListingOption[] }) {
  const [liveStocks, setLiveStocks] = useState(stocks)
  const [entries, setEntries] = useState<MonitorEntry[]>(() => seedEntries(stocks))

  useEffect(() => {
    setLiveStocks(stocks)
  }, [stocks])

  useEffect(() => {
    setEntries(seedEntries(liveStocks))
  }, [liveStocks])

  useEffect(() => {
    if (liveStocks.length === 0) return

    let timeoutId: ReturnType<typeof setTimeout>

    const tick = () => {
      setEntries((prev) => {
        const updated = prev.map((entry) => ({
          ...entry,
          status: advanceStatus(entry.status),
        }))
        const nextEntries = [createRandomEntry(liveStocks, Date.now()), ...updated]
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
            <TableHead className='w-[14rem] max-sm:w-[3rem] max-sm:px-2'>Listing</TableHead>
            <TableHead className='w-[10rem] max-sm:w-auto max-sm:px-2'>Indicator</TableHead>
            <TableHead className='w-[12rem] max-sm:w-auto max-sm:px-2'>Workflow</TableHead>
            <TableHead className='w-[6rem] text-right max-sm:w-[3rem] max-sm:px-2'>
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {entries.map((entry) => {
              const statusConfig = STATUS_CONFIG[entry.status]

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
                      className={`inline-block size-2.5 shrink-0 rounded-full sm:hidden ${statusConfig.dotClassName}`}
                      aria-label={statusConfig.label}
                      title={statusConfig.label}
                    />
                    <Badge
                      variant='outline'
                      className={`hidden text-xs sm:inline-flex ${statusConfig.className}`}
                    >
                      {statusConfig.label}
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
