import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getRandomVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'

const logger = createLogger('CustomIndicatorsQueries')
const API_ENDPOINT = '/api/indicators/custom'

export const customIndicatorsKeys = {
  all: ['customIndicators'] as const,
  lists: () => [...customIndicatorsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...customIndicatorsKeys.lists(), workspaceId] as const,
  detail: (indicatorId: string) => [...customIndicatorsKeys.all, 'detail', indicatorId] as const,
}

export type CustomIndicator = CustomIndicatorDefinition

type ApiCustomIndicator = Partial<CustomIndicatorDefinition> & {
  id: string
  name: string
}

function normalizeCustomIndicator(
  indicator: ApiCustomIndicator,
  workspaceId: string
): CustomIndicatorDefinition {
  return {
    id: indicator.id,
    workspaceId: indicator.workspaceId ?? workspaceId,
    userId: indicator.userId ?? null,
    name: indicator.name,
    color:
      typeof indicator.color === 'string' && indicator.color.trim().length > 0
        ? indicator.color.trim()
        : undefined,
    calcCode: typeof indicator.calcCode === 'string' ? indicator.calcCode : '',
    createdAt:
      typeof indicator.createdAt === 'string'
        ? indicator.createdAt
        : indicator.updatedAt && typeof indicator.updatedAt === 'string'
          ? indicator.updatedAt
          : new Date().toISOString(),
    updatedAt: typeof indicator.updatedAt === 'string' ? indicator.updatedAt : undefined,
  }
}

function syncCustomIndicatorsToStore(
  workspaceId: string,
  indicators: CustomIndicatorDefinition[]
) {
  useCustomIndicatorsStore.getState().setIndicators(workspaceId, indicators)
}

async function fetchCustomIndicators(workspaceId: string): Promise<CustomIndicatorDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch custom indicators: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedIndicators: CustomIndicatorDefinition[] = []

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
        normalizeCustomIndicator(
          {
            id: indicator.id,
            name: indicator.name,
            workspaceId: indicator.workspaceId ?? workspaceId,
            userId: indicator.userId ?? null,
            color: indicator.color ?? undefined,
            calcCode: indicator.calcCode ?? '',
            createdAt: indicator.createdAt ?? undefined,
            updatedAt: indicator.updatedAt ?? undefined,
          },
          workspaceId
        )
      )
    } catch (error) {
      logger.warn(`Failed to normalize custom indicator at index ${index}`, { error })
    }
  })

  return normalizedIndicators
}

export function useCustomIndicators(workspaceId: string) {
  const query = useQuery<CustomIndicatorDefinition[]>({
    queryKey: customIndicatorsKeys.list(workspaceId),
    queryFn: () => fetchCustomIndicators(workspaceId),
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
        return `${indicator.id}:${updatedAt}:${indicator.name}:${indicator.color ?? ''}:${indicator.calcCode ?? ''}`
      })
      .join('|')

    if (signature === lastSyncRef.current) {
      return
    }

    lastSyncRef.current = signature
    syncCustomIndicatorsToStore(workspaceId, query.data)
  }, [query.data, workspaceId])

  return query
}

interface CreateCustomIndicatorParams {
  workspaceId: string
  indicator: Omit<CustomIndicatorDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>
}

export function useCreateCustomIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicator }: CreateCustomIndicatorParams) => {
      logger.info(`Creating custom indicator: ${indicator.name} in workspace ${workspaceId}`)

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

      logger.info(`Created custom indicator: ${indicator.name}`)
      return data.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: customIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}

interface UpdateCustomIndicatorParams {
  workspaceId: string
  indicatorId: string
  updates: Partial<Omit<CustomIndicatorDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>>
}

export function useUpdateCustomIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId, updates }: UpdateCustomIndicatorParams) => {
      logger.info(`Updating custom indicator: ${indicatorId} in workspace ${workspaceId}`)

      const currentIndicators = queryClient.getQueryData<CustomIndicatorDefinition[]>(
        customIndicatorsKeys.list(workspaceId)
      )
      const currentIndicator = currentIndicators?.find((indicator) => indicator.id === indicatorId)

      if (!currentIndicator) {
        throw new Error('Indicator not found')
      }

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indicators: [
            {
              id: indicatorId,
              name: updates.name ?? currentIndicator.name,
              color: updates.color ?? currentIndicator.color,
              calcCode: updates.calcCode ?? currentIndicator.calcCode,
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

      logger.info(`Updated custom indicator: ${indicatorId}`)
      return data.data
    },
    onMutate: async ({ workspaceId, indicatorId, updates }) => {
      await queryClient.cancelQueries({ queryKey: customIndicatorsKeys.list(workspaceId) })

      const previousIndicators = queryClient.getQueryData<CustomIndicatorDefinition[]>(
        customIndicatorsKeys.list(workspaceId)
      )

      if (previousIndicators) {
        queryClient.setQueryData<CustomIndicatorDefinition[]>(
          customIndicatorsKeys.list(workspaceId),
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
          customIndicatorsKeys.list(variables.workspaceId),
          context.previousIndicators
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: customIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}

interface DeleteCustomIndicatorParams {
  workspaceId: string
  indicatorId: string
}

export function useDeleteCustomIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId }: DeleteCustomIndicatorParams) => {
      logger.info(`Deleting custom indicator: ${indicatorId}`)

      const url = `${API_ENDPOINT}?id=${indicatorId}&workspaceId=${workspaceId}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete indicator')
      }

      logger.info(`Deleted custom indicator: ${indicatorId}`)
      return true
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: customIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}
