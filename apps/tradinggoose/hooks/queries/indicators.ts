import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getRandomVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { useIndicatorsStore } from '@/stores/indicators/store'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type { InputMetaMap } from '@/lib/indicators/types'

const logger = createLogger('IndicatorsQueries')
const API_ENDPOINT = '/api/indicators/custom'

export const indicatorKeys = {
  all: ['indicators'] as const,
  lists: () => [...indicatorKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...indicatorKeys.lists(), workspaceId] as const,
  detail: (indicatorId: string) => [...indicatorKeys.all, 'detail', indicatorId] as const,
}

type ApiIndicator = Partial<IndicatorDefinition> & {
  id: string
  name: string
}

function normalizeIndicator(
  indicator: ApiIndicator,
  workspaceId: string
): IndicatorDefinition {
  return {
    id: indicator.id,
    workspaceId: indicator.workspaceId ?? workspaceId,
    userId: indicator.userId ?? null,
    name: indicator.name,
    color:
      typeof indicator.color === 'string' && indicator.color.trim().length > 0
        ? indicator.color.trim()
        : undefined,
    pineCode: typeof indicator.pineCode === 'string' ? indicator.pineCode : '',
    inputMeta:
      indicator.inputMeta && typeof indicator.inputMeta === 'object'
        ? (indicator.inputMeta as InputMetaMap)
        : undefined,
    createdAt:
      typeof indicator.createdAt === 'string'
        ? indicator.createdAt
        : indicator.updatedAt && typeof indicator.updatedAt === 'string'
          ? indicator.updatedAt
          : new Date().toISOString(),
    updatedAt: typeof indicator.updatedAt === 'string' ? indicator.updatedAt : undefined,
  }
}

function syncIndicatorsToStore(workspaceId: string, indicators: IndicatorDefinition[]) {
  useIndicatorsStore.getState().setIndicators(workspaceId, indicators)
}

async function fetchIndicators(workspaceId: string): Promise<IndicatorDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch indicators: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedIndicators: IndicatorDefinition[] = []

  data.forEach((indicator, index) => {
    if (!indicator || typeof indicator !== 'object') {
      logger.warn(`Skipping invalid indicator at index ${index}: not an object`)
      return
    }
    if (!indicator.id || typeof indicator.id !== 'string') {
      logger.warn(`Skipping invalid indicator at index ${index}: missing or invalid id`)
      return
    }
    if (!indicator.name || typeof indicator.name !== 'string') {
      logger.warn(`Skipping invalid indicator at index ${index}: missing or invalid name`)
      return
    }

    try {
      normalizedIndicators.push(
        normalizeIndicator(
          {
            id: indicator.id,
            name: indicator.name,
            workspaceId: indicator.workspaceId ?? workspaceId,
            userId: indicator.userId ?? null,
            color: indicator.color ?? undefined,
            pineCode: indicator.pineCode ?? '',
            inputMeta: indicator.inputMeta ?? undefined,
            createdAt: indicator.createdAt ?? undefined,
            updatedAt: indicator.updatedAt ?? undefined,
          },
          workspaceId
        )
      )
    } catch (error) {
      logger.warn(`Failed to normalize indicator at index ${index}`, { error })
    }
  })

  return normalizedIndicators
}

export function useIndicators(workspaceId: string) {
  const query = useQuery<IndicatorDefinition[]>({
    queryKey: indicatorKeys.list(workspaceId),
    queryFn: () => fetchIndicators(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const lastSyncRef = useRef<string>('')

  useEffect(() => {
    if (!workspaceId) return
    if (!query.data) return
    const signature = query.data
      .map((indicator) => {
        const updatedAt =
          typeof indicator.updatedAt === 'string' ? indicator.updatedAt : indicator.createdAt ?? ''
        return `${indicator.id}:${updatedAt}:${indicator.name}:${indicator.color ?? ''}:${indicator.pineCode ?? ''}`
      })
      .join('|')

    if (signature === lastSyncRef.current) {
      return
    }

    lastSyncRef.current = signature
    syncIndicatorsToStore(workspaceId, query.data)
  }, [query.data, workspaceId])

  return query
}

interface CreateIndicatorParams {
  workspaceId: string
  indicator: Omit<
    IndicatorDefinition,
    'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'
  >
}

export function useCreateIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicator }: CreateIndicatorParams) => {
      logger.info(`Creating indicator: ${indicator.name} in workspace ${workspaceId}`)

      const resolvedIndicator = {
        ...indicator,
        color:
          typeof indicator.color === 'string' && indicator.color.trim().length > 0
            ? indicator.color.trim()
            : getRandomVibrantColor(),
      }

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicators: [resolvedIndicator],
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: indicatorKeys.list(variables.workspaceId) })
    },
  })
}

interface UpdateIndicatorParams {
  workspaceId: string
  indicatorId: string
  updates: Partial<
    Omit<IndicatorDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>
  >
}

export function useUpdateIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId, updates }: UpdateIndicatorParams) => {
      logger.info(`Updating indicator: ${indicatorId} in workspace ${workspaceId}`)

      const currentIndicators = queryClient.getQueryData<IndicatorDefinition[]>(
        indicatorKeys.list(workspaceId)
      )
      const currentIndicator = currentIndicators?.find((indicator) => indicator.id === indicatorId)

      if (!currentIndicator) {
        throw new Error('Indicator not found')
      }

      const resolvedInputMeta = Object.prototype.hasOwnProperty.call(updates, 'inputMeta')
        ? updates.inputMeta
        : currentIndicator.inputMeta

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicators: [
            {
              id: indicatorId,
              name: updates.name ?? currentIndicator.name,
              color: updates.color ?? currentIndicator.color,
              pineCode: updates.pineCode ?? currentIndicator.pineCode,
              inputMeta: resolvedInputMeta,
            },
          ],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update indicator')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing indicators data')
      }

      logger.info(`Updated indicator: ${indicatorId}`)
      return data.data
    },
    onMutate: async ({ workspaceId, indicatorId, updates }) => {
      await queryClient.cancelQueries({ queryKey: indicatorKeys.list(workspaceId) })

      const previousIndicators = queryClient.getQueryData<IndicatorDefinition[]>(
        indicatorKeys.list(workspaceId)
      )

      if (previousIndicators) {
        queryClient.setQueryData<IndicatorDefinition[]>(
          indicatorKeys.list(workspaceId),
          previousIndicators.map((indicator) =>
            indicator.id === indicatorId
              ? {
                ...indicator,
                ...updates,
              }
              : indicator
          )
        )
      }

      return { previousIndicators }
    },
    onError: (_err, variables, context) => {
      if (context?.previousIndicators) {
        queryClient.setQueryData(
          indicatorKeys.list(variables.workspaceId),
          context.previousIndicators
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: indicatorKeys.list(variables.workspaceId) })
    },
  })
}

interface DeleteIndicatorParams {
  workspaceId: string
  indicatorId: string
}

export function useDeleteIndicator() {
  const queryClient = useQueryClient()

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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: indicatorKeys.list(variables.workspaceId) })
    },
  })
}

export function useVerifyIndicator() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      pineCode,
      inputs,
    }: {
      workspaceId: string
      pineCode: string
      inputs?: Record<string, unknown>
    }) => {
      const response = await fetch('/api/indicators/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, pineCode, inputs }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Verification failed (${response.status})`)
      }

      return payload?.data
    },
  })
}
