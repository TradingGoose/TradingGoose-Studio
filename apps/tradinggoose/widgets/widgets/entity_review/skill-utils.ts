import { resolveEntityId } from '@/widgets/widgets/entity_review/resolve-entity-id'

export const SKILL_LIST_WIDGET_KEY = 'list_skill'
export const SKILL_EDITOR_WIDGET_KEY = 'editor_skill'

export const getSkillIdFromParams = (params?: Record<string, unknown> | null) =>
  resolveEntityId('skillId', { params })

export const resolveSkillId = ({
  params,
  pairContext,
}: {
  params?: Record<string, unknown> | null
  pairContext?: { skillId?: string | null } | null
}) => resolveEntityId('skillId', { params, pairContext })

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}
