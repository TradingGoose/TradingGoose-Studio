'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import type { MonitorStock } from '@/app/(landing)/components/monitor-preview/fetch-listings'

type MonitorEntry = {
  id: string
  stock: MonitorStock
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
  success: { label: 'Success', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/20' },
}

const MAX_ROWS = 20

const RANDOM_STATUSES: MonitorEntry['status'][] = ['pending', 'pending', 'running']

function createRandomEntry(stocks: MonitorStock[], counter: number): MonitorEntry {
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
  // Each status has a random chance to advance per tick
  if (status === 'pending') return Math.random() < 0.5 ? 'running' : 'pending'
  if (status === 'running') {
    if (Math.random() < 0.4) return 'success'
    if (Math.random() < 0.08) return 'failed'
    return 'running'
  }
  return status
}

export default function MonitorPreview({ stocks }: { stocks: MonitorStock[] }) {
  const [entries, setEntries] = useState<MonitorEntry[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setEntries(
      Array.from({ length: 6 }, (_, i) => {
        const e = createRandomEntry(stocks, i)
        e.status = ['success', 'running', 'success', 'running', 'success', 'pending'][i] as MonitorEntry['status']
        return e
      })
    )
    setMounted(true)
  }, [stocks])

  useEffect(() => {
    if (!mounted) return
    let timeoutId: ReturnType<typeof setTimeout>

    const tick = () => {
      setEntries((prev) => {
        const updated = prev.map((entry) => ({
          ...entry,
          status: advanceStatus(entry.status),
        }))
        const newEntries = [createRandomEntry(stocks, Date.now()), ...updated]
        return newEntries.slice(0, MAX_ROWS)
      })
      // Random interval between 1.5s and 7s
      timeoutId = setTimeout(tick, 1500 + Math.random() * 5500)
    }

    timeoutId = setTimeout(tick, 1500 + Math.random() * 5500)
    return () => clearTimeout(timeoutId)
  }, [stocks, mounted])

  return (
    <div className='relative w-full overflow-hidden rounded-lg border bg-background/50 backdrop-blur-sm max-h-[420px]'>
      <div className='pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-1/3 bg-gradient-to-t from-background to-transparent' />
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
                  <TableCell>
                    <div className='flex items-center gap-3'>
                      <Avatar className='size-7 rounded-sm bg-secondary/60'>
                        {entry.stock.iconUrl && <AvatarImage src={entry.stock.iconUrl} alt={entry.stock.ticker} />}
                        <AvatarFallback className='rounded-sm bg-secondary/60 text-[10px] font-medium'>
                          {entry.stock.ticker.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex flex-col'>
                        <span className='font-mono font-medium text-sm leading-tight'>{entry.stock.ticker}</span>
                        <span className='text-xs text-muted-foreground leading-tight'>{entry.stock.name}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <span
                        className='size-2 rounded-full shrink-0'
                        style={{ backgroundColor: entry.indicatorColor }}
                      />
                      <span className='text-sm text-muted-foreground'>{entry.indicator}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <span
                        className='size-2 rounded-full shrink-0'
                        style={{ backgroundColor: entry.workflowColor }}
                      />
                      <span className='text-sm text-muted-foreground'>{entry.workflow}</span>
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
