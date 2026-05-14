const SKILL_LOADER_MARKER = '__tradinggooseSkillLoader'
export const SKILL_LOADER_TOOL_PREFIX = 'tradinggoose_internal_load_skill'

export interface SkillMetadata {
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
          enum: skillNames,
          description: 'Name of the skill to load',
        },
      },
      required: ['skill_name'],
    },
  }
}
