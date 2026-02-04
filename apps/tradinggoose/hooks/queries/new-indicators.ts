import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { getRandomVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { useNewIndicatorsStore } from '@/stores/new-indicators/store'
import type { NewIndicatorDefinition } from '@/stores/new-indicators/types'
import type { InputMetaMap } from '@/lib/new_indicators/types'

const logger = createLogger('NewIndicatorsQueries')
const API_ENDPOINT = '/api/new_indicators/custom'

export const newIndicatorsKeys = {
  all: ['newIndicators'] as const,
  lists: () => [...newIndicatorsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...newIndicatorsKeys.lists(), workspaceId] as const,
  detail: (indicatorId: string) => [...newIndicatorsKeys.all, 'detail', indicatorId] as const,
}

type ApiNewIndicator = Partial<NewIndicatorDefinition> & {
  id: string
  name: string
}

function normalizeNewIndicator(
  indicator: ApiNewIndicator,
  workspaceId: string
): NewIndicatorDefinition {
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

function syncNewIndicatorsToStore(workspaceId: string, indicators: NewIndicatorDefinition[]) {
  useNewIndicatorsStore.getState().setIndicators(workspaceId, indicators)
}

async function fetchNewIndicators(workspaceId: string): Promise<NewIndicatorDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch pine indicators: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedIndicators: NewIndicatorDefinition[] = []

  data.forEach((indicator, index) => {
    if (!indicator || typeof indicator !== 'object') {
      logger.warn(`Skipping invalid pine indicator at index ${index}: not an object`)
      return
    }
    if (!indicator.id || typeof indicator.id !== 'string') {
      logger.warn(`Skipping invalid pine indicator at index ${index}: missing or invalid id`)
      return
    }
    if (!indicator.name || typeof indicator.name !== 'string') {
      logger.warn(`Skipping invalid pine indicator at index ${index}: missing or invalid name`)
      return
    }

    try {
      normalizedIndicators.push(
        normalizeNewIndicator(
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
      logger.warn(`Failed to normalize pine indicator at index ${index}`, { error })
    }
  })

  return normalizedIndicators
}

export function useNewIndicators(workspaceId: string) {
  const query = useQuery<NewIndicatorDefinition[]>({
    queryKey: newIndicatorsKeys.list(workspaceId),
    queryFn: () => fetchNewIndicators(workspaceId),
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
    syncNewIndicatorsToStore(workspaceId, query.data)
  }, [query.data, workspaceId])

  return query
}

interface CreateNewIndicatorParams {
  workspaceId: string
  indicator: Omit<
    NewIndicatorDefinition,
    'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'
  >
}

export function useCreateNewIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicator }: CreateNewIndicatorParams) => {
      logger.info(`Creating pine indicator: ${indicator.name} in workspace ${workspaceId}`)

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

      logger.info(`Created pine indicator: ${indicator.name}`)
      return data.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: newIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}

interface UpdateNewIndicatorParams {
  workspaceId: string
  indicatorId: string
  updates: Partial<
    Omit<NewIndicatorDefinition, 'id' | 'workspaceId' | 'userId' | 'createdAt' | 'updatedAt'>
  >
}

export function useUpdateNewIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId, updates }: UpdateNewIndicatorParams) => {
      logger.info(`Updating pine indicator: ${indicatorId} in workspace ${workspaceId}`)

      const currentIndicators = queryClient.getQueryData<NewIndicatorDefinition[]>(
        newIndicatorsKeys.list(workspaceId)
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

      logger.info(`Updated pine indicator: ${indicatorId}`)
      return data.data
    },
    onMutate: async ({ workspaceId, indicatorId, updates }) => {
      await queryClient.cancelQueries({ queryKey: newIndicatorsKeys.list(workspaceId) })

      const previousIndicators = queryClient.getQueryData<NewIndicatorDefinition[]>(
        newIndicatorsKeys.list(workspaceId)
      )

      if (previousIndicators) {
        queryClient.setQueryData<NewIndicatorDefinition[]>(
          newIndicatorsKeys.list(workspaceId),
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
          newIndicatorsKeys.list(variables.workspaceId),
          context.previousIndicators
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: newIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}

interface DeleteNewIndicatorParams {
  workspaceId: string
  indicatorId: string
}

export function useDeleteNewIndicator() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, indicatorId }: DeleteNewIndicatorParams) => {
      logger.info(`Deleting pine indicator: ${indicatorId}`)

      const url = `${API_ENDPOINT}?id=${indicatorId}&workspaceId=${workspaceId}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete indicator')
      }

      logger.info(`Deleted pine indicator: ${indicatorId}`)
      return true
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: newIndicatorsKeys.list(variables.workspaceId) })
    },
  })
}

export function useVerifyNewIndicator() {
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
      const response = await fetch('/api/new_indicators/verify', {
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
