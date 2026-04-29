'use client'

import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { UnifiedTradingPortfolioPerformancePoint } from '@/providers/trading/types'

const chartConfig = {
  equity: {
    label: 'Equity',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const formatCurrency = (
  value: number,
  currency: string,
  notation?: Intl.NumberFormatOptions['notation']
) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation,
    maximumFractionDigits: notation === 'compact' ? 1 : 2,
  }).format(value)

const formatChartDate = (timestamp: string) => {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(parsed))
}

const formatTooltipDate = (timestamp: string) => {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return timestamp

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}

export function PortfolioSnapshotPerformanceChart({
  series,
  currency = 'USD',
}: {
  series: UnifiedTradingPortfolioPerformancePoint[]
  currency?: string
}) {
  const chartData = useMemo(
    () =>
      series
        .map((point) => {
          const label = formatChartDate(point.timestamp)
          if (!label || !isFiniteNumber(point.equity)) {
            return null
          }

          return {
            label,
            equity: point.equity,
            tooltipLabel: formatTooltipDate(point.timestamp),
          }
        })
        .filter(
          (
            point
          ): point is {
            label: string
            equity: number
            tooltipLabel: string
          } => point !== null
        ),
    [series]
  )

  if (chartData.length === 0) {
    return (
      <div className='flex h-full min-h-[190px] items-center justify-center rounded-md border border-border/60 border-dashed bg-background/60 px-4 text-center text-muted-foreground text-sm'>
        No performance points returned for this window.
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className='h-full min-h-[190px] w-full'>
      <AreaChart accessibilityLayer data={chartData} margin={{ top: 12, right: 16, left: 0 }}>
        <defs>
          <linearGradient id='fillEquity' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='5%' stopColor='var(--color-equity)' stopOpacity={0.35} />
            <stop offset='95%' stopColor='var(--color-equity)' stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray='3 3' />
        <XAxis dataKey='label' tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
        <YAxis
          width={64}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value) =>
            isFiniteNumber(value) ? formatCurrency(value, currency, 'compact') : String(value)
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator='line'
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as { tooltipLabel?: string } | undefined
                return point?.tooltipLabel ?? ''
              }}
              formatter={(value) => (
                <div className='flex min-w-[8rem] items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>Equity</span>
                  <span className='font-medium font-mono text-foreground tabular-nums'>
                    {isFiniteNumber(value) ? formatCurrency(value, currency) : String(value)}
                  </span>
                </div>
              )}
            />
          }
        />
        <Area
          dataKey='equity'
          type='natural'
          fill='url(#fillEquity)'
          fillOpacity={1}
          stroke='var(--color-equity)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  )
}
