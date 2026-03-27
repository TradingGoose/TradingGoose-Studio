import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { SkillInput } from '@/executor/handlers/agent/types'

const logger = createLogger('SkillsResolver')

const SKILL_LOADER_MARKER = '__tradinggooseSkillLoader'
export const SKILL_LOADER_TOOL_PREFIX = 'tradinggoose_internal_load_skill'

interface SkillRecord {
  id: string
  name: string
  description: string
  content: string
}

interface SkillMetadata {
  name: string
  description: string
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function fetchWorkspaceSkills(
  workspaceId: string,
  workflowId?: string
): Promise<SkillRecord[]> {
  if (!workspaceId) {
    return []
  }

  try {
    const headers: Record<string, string> = {}

    if (typeof window === 'undefined') {
      const { generateInternalToken } = await import('@/lib/auth/internal')
      const internalToken = await generateInternalToken()
      headers.Authorization = `Bearer ${internalToken}`
    }

    const url = new URL('/api/skills', getBaseUrl())
    url.searchParams.set('workspaceId', workspaceId)

    if (workflowId) {
      url.searchParams.set('workflowId', workflowId)
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to fetch workspace skills', {
        workspaceId,
        workflowId,
        status: response.status,
        errorText,
      })
      return []
    }

    const result = await response.json().catch(() => null)
    const skills: unknown[] = Array.isArray(result?.data) ? result.data : []

    return skills
      .filter(
        (skill): skill is SkillRecord =>
          Boolean(skill) &&
          typeof skill === 'object' &&
          typeof (skill as { id?: unknown }).id === 'string' &&
          typeof (skill as { name?: unknown }).name === 'string' &&
          typeof (skill as { description?: unknown }).description === 'string' &&
          typeof (skill as { content?: unknown }).content === 'string'
      )
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
      }))
  } catch (error) {
    logger.error('Error fetching workspace skills', { error, workspaceId, workflowId })
    return []
  }
}

export function createSkillLoaderToolId(existingToolIds: string[]): string {
  const usedToolIds = new Set(
    existingToolIds
      .map((toolId) => (typeof toolId === 'string' ? toolId.trim() : ''))
      .filter((toolId) => toolId.length > 0)
  )

  let nextToolId = SKILL_LOADER_TOOL_PREFIX
  let suffix = 2

  while (usedToolIds.has(nextToolId)) {
    nextToolId = `${SKILL_LOADER_TOOL_PREFIX}_${suffix}`
    suffix += 1
  }

  return nextToolId
}

export function isSkillLoaderToolId(toolId: string): boolean {
  return (
    toolId === 'load_skill' ||
    toolId === SKILL_LOADER_TOOL_PREFIX ||
    /^tradinggoose_internal_load_skill_\d+$/.test(toolId)
  )
}

export function isSkillLoaderExecution(params: Record<string, any>): boolean {
  return params?.[SKILL_LOADER_MARKER] === true
}

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string,
  workflowId?: string
): Promise<SkillMetadata[]> {
  const skillIds = skillInputs
    .map((skillInput) => skillInput.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0)

  if (skillIds.length === 0 || !workspaceId) {
    return []
  }

  const workspaceSkills = await fetchWorkspaceSkills(workspaceId, workflowId)
  const selectedSkillIds = new Set(skillIds)

  return workspaceSkills
    .filter((skill) => selectedSkillIds.has(skill.id))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
    }))
}

export async function resolveSkillContent(
  skillName: string,
  workspaceId: string,
  workflowId?: string
): Promise<string | null> {
  if (!skillName || !workspaceId) {
    return null
  }

  const workspaceSkills = await fetchWorkspaceSkills(workspaceId, workflowId)
  const matchedSkill = workspaceSkills.find((skill) => skill.name === skillName)

  if (!matchedSkill) {
    logger.warn('Skill not found', { skillName, workspaceId, workflowId })
    return null
  }

  return matchedSkill.content
}

export function buildSkillsSystemPromptSection(
  skills: SkillMetadata[],
  skillLoaderToolId: string
): string {
  if (skills.length === 0) {
    return ''
  }

  const skillEntries = skills
    .map(
      (skillMetadata) =>
        `  <skill name="${escapeXml(skillMetadata.name)}">\n    <description>${escapeXml(skillMetadata.description)}</description>\n  </skill>`
    )
    .join('\n')

  return [
    '',
    `You have access to the following skills. Use the ${skillLoaderToolId} tool to activate a skill when relevant.`,
    '',
    '<available_skills>',
    skillEntries,
    '</available_skills>',
  ].join('\n')
}

export function buildLoadSkillTool(skillLoaderToolId: string, skillNames: string[]) {
  return {
    id: skillLoaderToolId,
    name: skillLoaderToolId,
    description: `Load a skill to get specialized instructions. Available skills: ${skillNames.join(', ')}`,
    params: {
      [SKILL_LOADER_MARKER]: true,
    },
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of the skill to load',
          enum: skillNames,
        },
      },
      required: ['skill_name'],
    },
  }
}
