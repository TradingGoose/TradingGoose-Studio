import type { ImportedSkillTransferRecord } from '@/lib/skills/import-export'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')

export type ImportedWorkflowSkillReference = {
  skillId: string
  name: string
}

export function buildImportedWorkflowSkillsLookup({
  expectedSkills,
  importedSkills,
}: {
  expectedSkills: Array<{ name: string }>
  importedSkills: unknown
}): Map<string, ImportedWorkflowSkillReference> {
  const expectedSkillNames = expectedSkills.map((skill) => normalizeInlineWhitespace(skill.name))
  const expectedSkillNamesSet = new Set(expectedSkillNames)

  if (expectedSkillNamesSet.size === 0) {
    return new Map()
  }

  if (!Array.isArray(importedSkills)) {
    throw new Error('Failed to import workflow skills')
  }

  if (importedSkills.length !== expectedSkillNamesSet.size) {
    throw new Error('Failed to import workflow skills')
  }

  const importedSkillsBySourceName = new Map<string, ImportedWorkflowSkillReference>()

  importedSkills.forEach((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Failed to import workflow skills')
    }

    const importedSkill = item as Partial<ImportedSkillTransferRecord>
    const sourceName =
      typeof importedSkill.sourceName === 'string'
        ? normalizeInlineWhitespace(importedSkill.sourceName)
        : ''
    const skillId =
      typeof importedSkill.skillId === 'string'
        ? normalizeInlineWhitespace(importedSkill.skillId)
        : ''
    const name =
      typeof importedSkill.name === 'string' ? normalizeInlineWhitespace(importedSkill.name) : ''

    if (!sourceName || !skillId || !name) {
      throw new Error('Failed to import workflow skills')
    }

    if (!expectedSkillNamesSet.has(sourceName)) {
      throw new Error('Failed to import workflow skills')
    }

    if (importedSkillsBySourceName.has(sourceName)) {
      throw new Error('Failed to import workflow skills')
    }

    importedSkillsBySourceName.set(sourceName, {
      skillId,
      name,
    })
  })

  if (importedSkillsBySourceName.size !== expectedSkillNamesSet.size) {
    throw new Error('Failed to import workflow skills')
  }

  return importedSkillsBySourceName
}
