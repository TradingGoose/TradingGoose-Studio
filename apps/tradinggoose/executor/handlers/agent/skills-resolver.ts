import { createLogger } from '@/lib/logs/console/logger'
import {
  readSavedEntityFieldsForExecution,
  readSavedEntityListFieldsForExecution,
} from '@/lib/yjs/server/bootstrap-review-target'
import type { SkillInput } from '@/executor/handlers/agent/types'
import type { SkillMetadata } from './skill-loader'

const logger = createLogger('AgentSkillsResolver')

export async function resolveSkillMetadata(
  skillInputs: SkillInput[],
  workspaceId: string,
  isDeployedContext: boolean
): Promise<SkillMetadata[]> {
  const skillIds = skillInputs
    .map((skillInput) => skillInput.skillId)
    .filter((skillId): skillId is string => typeof skillId === 'string' && skillId.length > 0)

  if (skillIds.length === 0 || !workspaceId) {
    return []
  }

  const requested = new Set(skillIds)
  const entries = await readSavedEntityListFieldsForExecution(
    'skill',
    workspaceId,
    isDeployedContext
  )
  const resolved = entries
    .filter((entry) => requested.has(entry.entityId))
    .map((entry) => ({
      id: entry.entityId,
      name: entry.entityName,
      description: String(entry.fields.description ?? ''),
    }))
  const resolvedIds = new Set(resolved.map((entry) => entry.id))
  for (const skillId of skillIds) {
    if (!resolvedIds.has(skillId)) logger.warn(`Skipping unavailable agent skill ${skillId}`)
  }
  return resolved
}

export async function resolveSkillContent(
  skillId: string,
  workspaceId: string,
  isDeployedContext: boolean
): Promise<string> {
  const fields = await readSavedEntityFieldsForExecution(
    'skill',
    skillId,
    workspaceId,
    isDeployedContext
  )
  return String(fields.content ?? '')
}
