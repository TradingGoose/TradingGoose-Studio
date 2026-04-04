export const SKILL_LIST_WIDGET_KEY = 'list_skill'
export const SKILL_EDITOR_WIDGET_KEY = 'editor_skill'

export const getSkillIdFromParams = (params?: Record<string, unknown> | null) => {
  if (!params || typeof params !== 'object') return null
  const value = params.skillId
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export const resolveSkillId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { skillId?: string | null } | null
}) => {
  if (pairContext && Object.hasOwn(pairContext, 'skillId')) {
    const value = pairContext.skillId
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  return getSkillIdFromParams(params)
}

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}
