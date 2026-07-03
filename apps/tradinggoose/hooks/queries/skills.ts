import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { type ImportedSkillTransferRecord, SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import type { SkillDefinition } from '@/lib/skills/types'

const logger = createLogger('SkillsQueries')
const API_ENDPOINT = '/api/skills'
const normalizeSkillNameInput = (value: string) => value.trim().replace(/\s+/g, ' ')

export interface ImportSkillsResponse {
  success: boolean
  data: SkillDefinition[]
  importedSkills: ImportedSkillTransferRecord[]
  import: {
    addedCount: number
    renamedCount: number
  }
}

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
    createdAt: typeof rawSkill.createdAt === 'string' ? rawSkill.createdAt : undefined,
    updatedAt: typeof rawSkill.updatedAt === 'string' ? rawSkill.updatedAt : undefined,
  }
}

export async function fetchSkills(workspaceId: string): Promise<SkillDefinition[]> {
  const params = new URLSearchParams({ workspaceId })
  const response = await fetch(`${API_ENDPOINT}?${params}`)

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

interface ImportSkillsParams {
  workspaceId: string
  file: unknown
}

export function useImportSkills() {
  const queryClient = useQueryClient()

  return useMutation<ImportSkillsResponse, Error, ImportSkillsParams>({
    mutationFn: async ({
      workspaceId,
      file,
    }: ImportSkillsParams): Promise<ImportSkillsResponse> => {
      logger.info(`Importing skills into workspace ${workspaceId}`)

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
        throw new Error(data.error || 'Failed to import skills')
      }

      return data as ImportSkillsResponse
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(variables.workspaceId) })
    },
  })
}

export function isValidSkillName(name: string) {
  const normalizedName = normalizeSkillNameInput(name)
  return normalizedName.length > 0 && normalizedName.length <= SKILL_NAME_MAX_LENGTH
}
