import { z } from 'zod'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import {
  normalizeSkillsForTransfer,
  resolveImportedSkillName,
  type SkillTransferRecord,
  SkillTransferSchema,
} from '@/lib/skills/import-export'
import { type ExportWorkflowState, sanitizeForExport } from '@/lib/workflows/json-sanitizer'
import type { SkillDefinition } from '@/stores/skills/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export const WORKFLOW_EXPORT_SOURCE = 'workflowEditor'
export const IMPORTED_WORKFLOW_MARKER = '(imported)'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const normalizeString = (value: string) => value.trim()

const formatZodIssue = (issue: z.ZodIssue) => {
  const path = issue.path.join('.')
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message
}

export interface WorkflowTransferRecord {
  name: string
  description: string
  color: string
  state: ExportWorkflowState['state']
  skills: SkillTransferRecord[]
}

type WorkflowSkillSource = Pick<SkillDefinition, 'id' | 'name' | 'description' | 'content'>

type WorkflowTransferInput = {
  name: string
  description?: string | null
  color?: string | null
  state?: unknown
}

type ParseWorkflowImportResult = {
  data: WorkflowTransferRecord | null
  errors: string[]
  matched: boolean
}

const WorkflowTransferSchema = z
  .object({
    name: z
      .string()
      .transform(normalizeInlineWhitespace)
      .pipe(z.string().min(1, 'Workflow name is required')),
    description: z.string().transform(normalizeString).optional().default(''),
    color: z.string().transform(normalizeString).optional().default(''),
    state: z.unknown(),
  })
  .strict()

const WorkflowImportEnvelopeSchema = TradingGooseExportEnvelopeSchema.extend({
  workflows: z.array(WorkflowTransferSchema).length(1, 'Exactly one workflow is required'),
  skills: z.array(SkillTransferSchema).default([]),
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('workflows')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include workflows',
      path: ['resourceTypes'],
    })
  }

  const includesSkills = value.resourceTypes.includes('skills')
  const hasSkills = value.skills.length > 0

  if (includesSkills && !hasSkills) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one skill is required when resourceTypes includes skills',
      path: ['skills'],
    })
    return
  }

  if (hasSkills && !includesSkills) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include skills when skills are provided',
      path: ['resourceTypes'],
    })
    return
  }

  if (!includesSkills || !hasSkills) {
    return
  }

  const seenSkillNames = new Set<string>()

  value.skills.forEach((skill, index) => {
    if (seenSkillNames.has(skill.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate skill name "${skill.name}"`,
        path: ['skills', index, 'name'],
      })
      return
    }

    seenSkillNames.add(skill.name)
  })
})

const LegacyWorkflowImportEnvelopeSchema = z
  .object({
    version: z.literal('1.0'),
    exportedAt: z.string().datetime(),
    state: z.unknown(),
  })
  .strict()

type WorkflowSkillValue = {
  skillId: string
  name?: string
}

function validateWorkflowState(input: unknown): {
  data: ExportWorkflowState['state'] | null
  errors: string[]
} {
  const errors: string[] = []

  if (!input || typeof input !== 'object') {
    errors.push('Invalid workflow state: state must be an object')
    return { data: null, errors }
  }

  const workflowState = input as Record<string, any>

  if (!workflowState.blocks || typeof workflowState.blocks !== 'object') {
    errors.push('Missing or invalid field: blocks')
    return { data: null, errors }
  }

  if (!Array.isArray(workflowState.edges)) {
    errors.push('Missing or invalid field: edges (must be an array)')
    return { data: null, errors }
  }

  Object.entries(workflowState.blocks).forEach(([blockId, block]: [string, any]) => {
    if (!block || typeof block !== 'object') {
      errors.push(`Invalid block ${blockId}: must be an object`)
      return
    }

    if (!block.id) {
      errors.push(`Block ${blockId} missing required field: id`)
    }
    if (!block.type) {
      errors.push(`Block ${blockId} missing required field: type`)
    }
    if (
      !block.position ||
      typeof block.position.x !== 'number' ||
      typeof block.position.y !== 'number'
    ) {
      errors.push(`Block ${blockId} missing or invalid position`)
    }
  })

  workflowState.edges.forEach((edge: any, index: number) => {
    if (!edge || typeof edge !== 'object') {
      errors.push(`Invalid edge at index ${index}: must be an object`)
      return
    }

    if (!edge.id) {
      errors.push(`Edge at index ${index} missing required field: id`)
    }
    if (!edge.source) {
      errors.push(`Edge at index ${index} missing required field: source`)
    }
    if (!edge.target) {
      errors.push(`Edge at index ${index} missing required field: target`)
    }
  })

  if (errors.length > 0) {
    return { data: null, errors }
  }

  return {
    data: {
      blocks: workflowState.blocks || {},
      edges: workflowState.edges || [],
      loops: workflowState.loops || {},
      parallels: workflowState.parallels || {},
    },
    errors: [],
  }
}

function normalizeWorkflowTransferRecord(
  workflow: WorkflowTransferInput
): ParseWorkflowImportResult {
  const workflowName = normalizeInlineWhitespace(workflow.name)
  const stateResult = validateWorkflowState(workflow.state)

  if (stateResult.errors.length > 0 || !stateResult.data) {
    return {
      data: null,
      errors: stateResult.errors,
      matched: true,
    }
  }

  return {
    data: {
      name: workflowName,
      description: normalizeString(workflow.description ?? ''),
      color: normalizeString(workflow.color ?? ''),
      state: stateResult.data,
      skills: [],
    },
    errors: [],
    matched: true,
  }
}

function normalizeWorkflowSkillValue(
  blockId: string,
  value: unknown,
  index: number
): WorkflowSkillValue {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid skill value at index ${index} in block ${blockId}: must be an object`)
  }

  const skillValue = value as { skillId?: unknown; name?: unknown }
  const skillId =
    typeof skillValue.skillId === 'string' ? normalizeInlineWhitespace(skillValue.skillId) : ''

  if (!skillId) {
    throw new Error(`Invalid skill value at index ${index} in block ${blockId}: missing skillId`)
  }

  return {
    skillId,
    name:
      typeof skillValue.name === 'string' ? normalizeInlineWhitespace(skillValue.name) : undefined,
  }
}

function getWorkflowSkillValues(
  blockId: string,
  block: { subBlocks?: Record<string, { value?: unknown }> } | null | undefined
): WorkflowSkillValue[] {
  if (!block || typeof block !== 'object') {
    throw new Error(`Invalid block ${blockId}: must be an object`)
  }

  const skillSubBlock = block.subBlocks?.skills
  if (
    !skillSubBlock ||
    skillSubBlock.value === null ||
    typeof skillSubBlock.value === 'undefined'
  ) {
    return []
  }

  if (!Array.isArray(skillSubBlock.value)) {
    throw new Error(`Invalid skill values in block ${blockId}: expected an array`)
  }

  return skillSubBlock.value.map((value, index) =>
    normalizeWorkflowSkillValue(blockId, value, index)
  )
}

function collectWorkflowSkillIds(state: WorkflowState): string[] {
  const orderedSkillIds: string[] = []
  const seenSkillIds = new Set<string>()

  Object.entries(state.blocks).forEach(([blockId, block]) => {
    const skillValues = getWorkflowSkillValues(blockId, block)

    skillValues.forEach((skillValue) => {
      if (seenSkillIds.has(skillValue.skillId)) {
        return
      }

      seenSkillIds.add(skillValue.skillId)
      orderedSkillIds.push(skillValue.skillId)
    })
  })

  return orderedSkillIds
}

function rewriteWorkflowSkillValues(
  state: ExportWorkflowState['state'],
  namesBySkillId: Map<string, string>
): ExportWorkflowState['state'] {
  const clonedState = JSON.parse(JSON.stringify(state)) as ExportWorkflowState['state']

  Object.entries(clonedState.blocks).forEach(([blockId, block]) => {
    const workflowBlock = block as any
    const skillValues = getWorkflowSkillValues(blockId, workflowBlock)
    if (skillValues.length === 0) {
      return
    }

    workflowBlock.subBlocks.skills = {
      ...workflowBlock.subBlocks.skills,
      value: skillValues.map((skillValue) => {
        const resolvedName = namesBySkillId.get(skillValue.skillId)

        if (!resolvedName) {
          throw new Error(
            `Missing exported skill "${skillValue.skillId}" referenced by block ${blockId}`
          )
        }

        return {
          skillId: skillValue.skillId,
          name: resolvedName,
        }
      }),
    }
  })

  return clonedState
}

function buildWorkflowExportSkillData({
  state,
  skills,
}: {
  state: WorkflowState
  skills: WorkflowSkillSource[]
}): { state: ExportWorkflowState['state']; skills: SkillTransferRecord[] } {
  const sanitizedState = sanitizeForExport(state).state
  const skillById = new Map(skills.map((skill) => [skill.id, skill]))
  const skillIds = collectWorkflowSkillIds(sanitizedState)
  const usedNames = new Set<string>()
  const namesBySkillId = new Map<string, string>()

  const exportedSkills = normalizeSkillsForTransfer(
    skillIds.map((skillId) => {
      const skill = skillById.get(skillId)

      if (!skill) {
        throw new Error(`Workflow references unknown skill "${skillId}"`)
      }

      const resolvedName = resolveImportedSkillName(skill.name, usedNames)
      usedNames.add(resolvedName)
      namesBySkillId.set(skillId, resolvedName)

      return {
        name: resolvedName,
        description: skill.description,
        content: skill.content,
      }
    })
  )

  return {
    state: rewriteWorkflowSkillValues(sanitizedState, namesBySkillId),
    skills: exportedSkills,
  }
}

function parseUnifiedWorkflowImport(input: unknown): ParseWorkflowImportResult {
  const envelope = TradingGooseExportEnvelopeSchema.safeParse(input)
  if (!envelope.success) {
    return { data: null, errors: [], matched: false }
  }

  const parsed = WorkflowImportEnvelopeSchema.safeParse(input)

  if (!parsed.success) {
    return {
      data: null,
      errors: parsed.error.issues.map(formatZodIssue),
      matched: true,
    }
  }

  const workflow = parsed.data.workflows[0]
  if (!workflow) {
    return {
      data: null,
      errors: ['Exactly one workflow is required'],
      matched: true,
    }
  }

  const normalizedWorkflow = normalizeWorkflowTransferRecord(workflow)
  if (!normalizedWorkflow.data) {
    return normalizedWorkflow
  }

  return {
    data: {
      ...normalizedWorkflow.data,
      skills: parsed.data.skills ?? [],
    },
    errors: [],
    matched: true,
  }
}

function parseLegacyWorkflowImport(
  input: unknown,
  fallbackName?: string
): ParseWorkflowImportResult {
  const parsed = LegacyWorkflowImportEnvelopeSchema.safeParse(input)

  if (!parsed.success) {
    return { data: null, errors: [], matched: false }
  }

  const stateResult = validateWorkflowState(parsed.data.state)

  if (stateResult.errors.length > 0 || !stateResult.data) {
    return {
      data: null,
      errors: stateResult.errors,
      matched: true,
    }
  }

  const resolvedFallbackName = normalizeInlineWhitespace(fallbackName ?? 'Imported Workflow')

  return {
    data: {
      name: resolvedFallbackName.length > 0 ? resolvedFallbackName : 'Imported Workflow',
      description: 'Workflow imported from JSON',
      color: '',
      state: stateResult.data,
      skills: [],
    },
    errors: [],
    matched: true,
  }
}

export function createWorkflowExportFile({
  workflow,
  skills = [],
  exportedFrom = WORKFLOW_EXPORT_SOURCE,
}: {
  workflow: {
    name: string
    description?: string | null
    color?: string | null
    state: WorkflowState
  }
  skills?: WorkflowSkillSource[]
  exportedFrom?: string
}) {
  const exportData = buildWorkflowExportSkillData({
    state: workflow.state,
    skills,
  })

  return createTradingGooseExportFile({
    exportedFrom,
    resourceTypes: exportData.skills.length > 0 ? ['workflows', 'skills'] : ['workflows'],
    resources: {
      skills: exportData.skills,
      workflows: [
        {
          name: normalizeInlineWhitespace(workflow.name),
          description: normalizeString(workflow.description ?? ''),
          color: normalizeString(workflow.color ?? ''),
          state: exportData.state,
        },
      ],
    },
  })
}

export function exportWorkflowAsJson({
  workflow,
  skills = [],
  exportedFrom = WORKFLOW_EXPORT_SOURCE,
}: {
  workflow: {
    name: string
    description?: string | null
    color?: string | null
    state: WorkflowState
  }
  skills?: WorkflowSkillSource[]
  exportedFrom?: string
}): string {
  return JSON.stringify(createWorkflowExportFile({ workflow, skills, exportedFrom }), null, 2)
}

export function parseImportedWorkflowFile(
  input: unknown,
  options: { fallbackName?: string } = {}
): { data: WorkflowTransferRecord | null; errors: string[] } {
  const unifiedResult = parseUnifiedWorkflowImport(input)
  if (unifiedResult.data) {
    return {
      data: unifiedResult.data,
      errors: [],
    }
  }

  if (unifiedResult.matched && unifiedResult.errors.length > 0) {
    return {
      data: null,
      errors: unifiedResult.errors,
    }
  }

  const legacyResult = parseLegacyWorkflowImport(input, options.fallbackName)
  if (legacyResult.data) {
    return {
      data: legacyResult.data,
      errors: [],
    }
  }

  if (legacyResult.matched && legacyResult.errors.length > 0) {
    return {
      data: null,
      errors: legacyResult.errors,
    }
  }

  return {
    data: null,
    errors: [
      'Unsupported JSON format: expected a unified TradingGoose export with workflows or a legacy workflow export with version and state fields',
    ],
  }
}

function buildImportedWorkflowName(name: string, number: number) {
  const normalizedName = normalizeInlineWhitespace(name)
  const suffix = ` ${number}`

  if (normalizedName.includes(IMPORTED_WORKFLOW_MARKER)) {
    return `${normalizedName}${suffix}`
  }

  return `${normalizedName} ${IMPORTED_WORKFLOW_MARKER}${suffix}`
}

export function resolveImportedWorkflowName(name: string, usedNames: Iterable<string>): string {
  const normalizedName = normalizeInlineWhitespace(name)
  const usedNamesSet = new Set(Array.from(usedNames).map(normalizeInlineWhitespace))

  if (!usedNamesSet.has(normalizedName)) {
    return normalizedName
  }

  let nextNumber = 1
  let candidate = buildImportedWorkflowName(normalizedName, nextNumber)

  while (usedNamesSet.has(candidate)) {
    nextNumber += 1
    candidate = buildImportedWorkflowName(normalizedName, nextNumber)
  }

  return candidate
}
