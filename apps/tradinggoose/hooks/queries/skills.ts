import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useSkillsStore } from '@/stores/skills/store'
import type { SkillDefinition } from '@/stores/skills/types'

const logger = createLogger('SkillsQueries')
const API_ENDPOINT = '/api/skills'
const KEBAB_CASE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const skillsKeys = {
  all: ['skills'] as const,
  lists: () => [...skillsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...skillsKeys.lists(), workspaceId] as const,
}

function normalizeSkill(
  rawSkill: Partial<SkillDefinition> & {
    id: string
    name: string
    description: string
    content: string
  },
  workspaceId: string
): SkillDefinition {
  return {
    id: rawSkill.id,
    workspaceId: rawSkill.workspaceId ?? workspaceId,
    userId: rawSkill.userId ?? null,
    name: rawSkill.name,
    description: rawSkill.description,
    content: rawSkill.content,
    createdAt:
      typeof rawSkill.createdAt === 'string'
        ? rawSkill.createdAt
        : rawSkill.updatedAt && typeof rawSkill.updatedAt === 'string'
          ? rawSkill.updatedAt
          : new Date().toISOString(),
    updatedAt: typeof rawSkill.updatedAt === 'string' ? rawSkill.updatedAt : undefined,
  }
}

function syncSkillsToStore(workspaceId: string, skills: SkillDefinition[]) {
  useSkillsStore.getState().setSkills(workspaceId, skills)
}

async function fetchSkills(workspaceId: string): Promise<SkillDefinition[]> {
  const response = await fetch(`${API_ENDPOINT}?workspaceId=${workspaceId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to fetch skills: ${response.statusText}`)
  }

  const { data } = await response.json()
  if (!Array.isArray(data)) {
    throw new Error('Invalid response format')
  }

  const normalizedSkills: SkillDefinition[] = []

  data.forEach((rawSkill, index) => {
    if (!rawSkill || typeof rawSkill !== 'object') {
      logger.warn(`Skipping invalid skill at index ${index}: not an object`)
      return
    }
    if (!rawSkill.id || typeof rawSkill.id !== 'string') {
      logger.warn(`Skipping invalid skill at index ${index}: missing or invalid id`)
      return
    }
    if (!rawSkill.name || typeof rawSkill.name !== 'string') {
      logger.warn(`Skipping invalid skill at index ${index}: missing or invalid name`)
      return
    }
    if (!rawSkill.description || typeof rawSkill.description !== 'string') {
      logger.warn(`Skipping invalid skill at index ${index}: missing or invalid description`)
      return
    }
    if (!rawSkill.content || typeof rawSkill.content !== 'string') {
      logger.warn(`Skipping invalid skill at index ${index}: missing or invalid content`)
      return
    }

    try {
      normalizedSkills.push(normalizeSkill(rawSkill, workspaceId))
    } catch (error) {
      logger.warn(`Failed to normalize skill at index ${index}`, { error })
    }
  })

  return normalizedSkills
}

export function useSkills(workspaceId: string) {
  const query = useQuery<SkillDefinition[]>({
    queryKey: skillsKeys.list(workspaceId),
    queryFn: () => fetchSkills(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })

  const lastSyncRef = useRef<string>('')

  useEffect(() => {
    lastSyncRef.current = ''
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || !query.data) return

    const signature = query.data
      .map((skill) => {
        const updatedAt =
          typeof skill.updatedAt === 'string' ? skill.updatedAt : (skill.createdAt ?? '')
        return `${skill.id}:${updatedAt}:${skill.name}:${skill.description}:${skill.content}`
      })
      .join('|')
    const syncKey = `${workspaceId}:${signature}`

    if (syncKey === lastSyncRef.current) {
      return
    }

    lastSyncRef.current = syncKey
    syncSkillsToStore(workspaceId, query.data)
  }, [query.data, workspaceId])

  return query
}

interface CreateSkillParams {
  workspaceId: string
  skill: {
    name: string
    description: string
    content: string
  }
}

export function useCreateSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skill }: CreateSkillParams) => {
      logger.info(`Creating skill: ${skill.name} in workspace ${workspaceId}`)

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: [skill],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create skill')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing skills data')
      }

      return data.data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

interface UpdateSkillParams {
  workspaceId: string
  skillId: string
  updates: {
    name?: string
    description?: string
    content?: string
  }
}

export function useUpdateSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skillId, updates }: UpdateSkillParams) => {
      logger.info(`Updating skill: ${skillId} in workspace ${workspaceId}`)

      const currentSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )
      const currentSkill = currentSkills?.find((skill) => skill.id === skillId)

      if (!currentSkill) {
        throw new Error('Skill not found')
      }

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skills: [
            {
              id: skillId,
              name: updates.name ?? currentSkill.name,
              description: updates.description ?? currentSkill.description,
              content: updates.content ?? currentSkill.content,
            },
          ],
          workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update skill')
      }

      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing skills data')
      }

      return data.data
    },
    onMutate: async ({ workspaceId, skillId, updates }) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.list(workspaceId) })

      const previousSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )

      if (previousSkills) {
        queryClient.setQueryData<SkillDefinition[]>(
          skillsKeys.list(workspaceId),
          previousSkills.map((skill) =>
            skill.id === skillId
              ? {
                  ...skill,
                  name: updates.name ?? skill.name,
                  description: updates.description ?? skill.description,
                  content: updates.content ?? skill.content,
                }
              : skill
          )
        )
      }

      return { previousSkills }
    },
    onError: (_err, variables, context) => {
      if (context?.previousSkills) {
        queryClient.setQueryData(skillsKeys.list(variables.workspaceId), context.previousSkills)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

interface DeleteSkillParams {
  workspaceId: string
  skillId: string
}

export function useDeleteSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, skillId }: DeleteSkillParams) => {
      logger.info(`Deleting skill: ${skillId}`)

      const url = `${API_ENDPOINT}?id=${skillId}&workspaceId=${workspaceId}`
      const response = await fetch(url, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete skill')
      }

      return data
    },
    onMutate: async ({ workspaceId, skillId }) => {
      await queryClient.cancelQueries({ queryKey: skillsKeys.list(workspaceId) })

      const previousSkills = queryClient.getQueryData<SkillDefinition[]>(
        skillsKeys.list(workspaceId)
      )

      if (previousSkills) {
        queryClient.setQueryData<SkillDefinition[]>(
          skillsKeys.list(workspaceId),
          previousSkills.filter((skill) => skill.id !== skillId)
        )
      }

      return { previousSkills, workspaceId }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSkills && context?.workspaceId) {
        queryClient.setQueryData(skillsKeys.list(context.workspaceId), context.previousSkills)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

export function isValidSkillName(name: string) {
  return KEBAB_CASE_REGEX.test(name)
}
