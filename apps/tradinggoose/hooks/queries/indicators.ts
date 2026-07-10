import { useMutation } from '@tanstack/react-query'
import type { IndicatorsImportFile, IndicatorTransferRecord } from '@/lib/indicators/import-export'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('IndicatorsQueries')
const API_ENDPOINT = '/api/indicators/custom'

interface CreateIndicatorParams {
  workspaceId: string
  indicator: IndicatorTransferRecord
}

export function useCreateIndicator() {
  return useMutation({
    mutationFn: async ({ workspaceId, indicator }: CreateIndicatorParams) => {
      logger.info(`Creating indicator: ${indicator.name} in workspace ${workspaceId}`)

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicators: [indicator],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create indicator')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing indicators data')
      }

      logger.info(`Created indicator: ${indicator.name}`)
      return data.data
    },
  })
}

interface ImportIndicatorsParams {
  workspaceId: string
  file: IndicatorsImportFile
}

export function useImportIndicators() {
  return useMutation({
    mutationFn: async ({ workspaceId, file }: ImportIndicatorsParams) => {
      logger.info(`Importing indicators into workspace ${workspaceId}`)

      const response = await fetch(`${API_ENDPOINT}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          file,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to import indicators')
      }

      return data
    },
  })
}

interface DeleteIndicatorParams {
  workspaceId: string
  indicatorId: string
}

export function useDeleteIndicator() {
  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId }: DeleteIndicatorParams) => {
      logger.info(`Deleting indicator: ${indicatorId}`)

      const url = `${API_ENDPOINT}?id=${indicatorId}&workspaceId=${workspaceId}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete indicator')
      }

      logger.info(`Deleted indicator: ${indicatorId}`)
      return true
    },
  })
}
