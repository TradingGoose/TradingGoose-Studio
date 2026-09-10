import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface KronosForecastParams {
  workspaceId?: string
  idempotencyKey?: string
  listing?: unknown
  marketSeries?: unknown
  interval?: string
  timezone?: string
  normalizationMode?: string
  horizonBars?: number
  parameters?: {
    temperature?: number
    topP?: number
    sampleCount?: number
  }
}

export interface KronosForecastResponse extends ToolResponse {
  output: {
    forecast: Array<{
      timestamp: string
      open: number
      high: number
      low: number
      close: number
      volume: number
      amount: number
    }>
    model: {
      name: string
      sourceRevision: string
      modelRevision: string
      tokenizerRevision: string
      device: string
      maxContext: number
    }
    input: {
      listing: {
        listingId: string
        listingType: string
      }
      interval: string
      timezone: string
      normalizationMode: string
      barCount: number
      lastCompletedBarTimestamp: string
    }
    parameters: {
      temperature: number
      topP: number
      sampleCount: number
    }
    diagnostics: {
      volumeImputed: boolean
      amountImputed: boolean
      candleReconciliationCount: number
      warnings: string[]
    }
    timingMs: {
      queue: number
      inference: number
      total: number
    }
  }
}

export const kronosForecastTool: ToolConfig<KronosForecastParams, KronosForecastResponse> = {
  id: 'kronos_forecast',
  name: 'Kronos Forecast',
  description: 'Generate a Kronos financial market forecast.',
  version: '1.0.0',
  execution: {
    workspace: { required: true, access: 'read' },
  },
  params: {
    listing: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Canonical listing payload from the Historical Data block.',
    },
    marketSeries: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'Normalized market series from the Historical Data block.',
    },
    interval: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Series interval/timeframe (e.g. 5m, 1h, 1d).',
    },
    timezone: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'IANA timezone for the listing (e.g. America/New_York).',
    },
    normalizationMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Normalization mode used when fetching the series.',
    },
    horizonBars: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of future bars to forecast.',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional sampling parameters (temperature, topP, sampleCount).',
    },
  },
  request: {
    url: '/api/providers/kronos/forecast',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      listing: params.listing,
      marketSeries: params.marketSeries,
      interval: params.interval,
      timezone: params.timezone,
      normalizationMode: params.normalizationMode,
      horizonBars: params.horizonBars,
      parameters: params.parameters,
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: data,
    }
  },
  outputs: {
    forecast: { type: 'json', description: 'Forecasted OHLCV points.' },
    model: { type: 'json', description: 'Model provenance metadata.' },
    input: { type: 'json', description: 'Input metadata for the forecast.' },
    parameters: { type: 'json', description: 'Effective sampling parameters.' },
    diagnostics: { type: 'json', description: 'Forecast diagnostics and warnings.' },
    timingMs: { type: 'json', description: 'Request timing in milliseconds.' },
  },
}
