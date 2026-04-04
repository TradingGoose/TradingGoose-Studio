'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { fetchListings } from '@/components/listing-selector/fetchers'
import { MarketListingRow } from '@/components/listing-selector/listing/row'
import { buildMarketSearchRequest } from '@/components/listing-selector/selector/search-request'
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
import { sortMonitorListings } from '@/app/(landing)/components/monitor-preview/listing-preference'

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

const STATUS_CONFIG: Record<MonitorEntry['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  running: { label: 'Running', className: 'bg-blue-500/15 text-blue-500 border-blue-500/20' },
  success: {
    label: 'Success',
    className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  },
  failed: {
    label: 'Failed',
    className: 'bg-destructive/15 text-destructive border-destructive/20',
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

const MONITOR_REFRESH_QUERY = buildMarketSearchRequest({
  rawQuery: 'a',
  providerConfig: {
    assetClasses: ['stock'],
    marketCodes: [],
    listingQuoteCodes: [],
    cryptoQuoteCodes: [],
    currencyQuoteCodes: [],
  },
}).queryParams

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
  return Array.from({ length: Math.min(INITIAL_ROWS, stocks.length) }, (_, index) => ({
    ...createRandomEntry(stocks, index),
    status: INITIAL_STATUSES[index] as MonitorEntry['status'],
  }))
}

function isFallbackStock(stock: ListingOption): boolean {
  return stock.listing_id.startsWith('fallback-')
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
    if (!stocks.some(isFallbackStock)) return

    const controller = new AbortController()

    void fetchListings(MONITOR_REFRESH_QUERY, controller.signal)
      .then((rows) => {
        if (rows.length > 0) setLiveStocks(sortMonitorListings(rows).slice(0, MAX_ROWS))
      })
      .catch(() => {})

    return () => controller.abort()
  }, [stocks])

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
      <Table>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            <TableHead>Listing</TableHead>
            <TableHead>Indicator</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead className='text-right'>Status</TableHead>
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
                  <TableCell className='min-w-0'>
                    <MarketListingRow listing={entry.stock} className='w-full min-w-0 pr-0' />
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: entry.indicatorColor }}
                      />
                      <span className='text-muted-foreground text-sm'>{entry.indicator}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <span
                        className='size-2 shrink-0 rounded-full'
                        style={{ backgroundColor: entry.workflowColor }}
                      />
                      <span className='text-muted-foreground text-sm'>{entry.workflow}</span>
                    </div>
                  </TableCell>
                  <TableCell className='text-right'>
                    <Badge variant='outline' className={`text-xs ${statusConfig.className}`}>
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
