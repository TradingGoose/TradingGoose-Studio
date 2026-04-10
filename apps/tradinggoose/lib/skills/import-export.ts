import { z } from 'zod'
import {
  createTradingGooseExportFile,
  TradingGooseExportEnvelopeSchema,
} from '@/lib/import-export/trading-goose'
import type { SkillDefinition } from '@/stores/skills/types'

export const SKILL_NAME_MAX_LENGTH = 64
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024
export const SKILL_CONTENT_MAX_LENGTH = 50000
export const IMPORTED_SKILL_MARKER = '(imported)'

const normalizeInlineWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')

const SkillNameSchema = z
  .string()
  .transform(normalizeInlineWhitespace)
  .pipe(
    z
      .string()
      .min(1, 'Skill name is required')
      .max(SKILL_NAME_MAX_LENGTH, `Skill name must be at most ${SKILL_NAME_MAX_LENGTH} characters`)
  )

const SkillDescriptionSchema = z
  .string()
  .transform(normalizeInlineWhitespace)
  .pipe(
    z
      .string()
      .min(1, 'Description is required')
      .max(
        SKILL_DESCRIPTION_MAX_LENGTH,
        `Description must be at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters`
      )
  )

const SkillContentSchema = z
  .string()
  .max(SKILL_CONTENT_MAX_LENGTH, 'Content is too large')
  .refine((value) => value.trim().length > 0, 'Content is required')

export const SkillTransferSchema = z
  .object({
    name: SkillNameSchema,
    description: SkillDescriptionSchema,
    content: SkillContentSchema,
  })
  .strict()

export const SkillsTransferListSchema = z
  .array(SkillTransferSchema)
  .min(1, 'At least one skill is required')

export const SkillsImportFileSchema = TradingGooseExportEnvelopeSchema.extend({
  skills: SkillsTransferListSchema,
}).superRefine((value, ctx) => {
  if (!value.resourceTypes.includes('skills')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceTypes must include skills',
      path: ['resourceTypes'],
    })
  }
})

export type SkillTransferRecord = z.infer<typeof SkillTransferSchema>
export type ImportedSkillTransferRecord = {
  sourceName: string
  skillId: string
  name: string
}
export type SkillsImportFile = z.infer<typeof SkillsImportFileSchema>

export function parseImportedSkillsFile(input: unknown): SkillTransferRecord[] {
  return SkillsImportFileSchema.parse(input).skills
}

export function normalizeSkillsForTransfer(
  skills: Array<Pick<SkillDefinition, 'name' | 'description' | 'content'>>
): SkillTransferRecord[] {
  return skills.map((skill) => ({
    name: normalizeInlineWhitespace(skill.name),
    description: normalizeInlineWhitespace(skill.description),
    content: skill.content,
  }))
}

export function createSkillsExportFile({
  skills,
  exportedFrom,
}: {
  skills: Array<Pick<SkillDefinition, 'name' | 'description' | 'content'>>
  exportedFrom: string
}) {
  return createTradingGooseExportFile({
    exportedFrom,
    resourceTypes: ['skills'],
    resources: {
      skills: normalizeSkillsForTransfer(skills),
    },
  })
}

export function exportSkillsAsJson({
  skills,
  exportedFrom,
}: {
  skills: Array<Pick<SkillDefinition, 'name' | 'description' | 'content'>>
  exportedFrom: string
}): string {
  return JSON.stringify(createSkillsExportFile({ skills, exportedFrom }), null, 2)
}

function truncateToLength(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength).trimEnd()
}

function buildImportedSkillName(name: string, number: number): string {
  const normalizedName = normalizeInlineWhitespace(name)
  const suffix = ` ${number}`

  if (normalizedName.includes(IMPORTED_SKILL_MARKER)) {
    const truncatedName = truncateToLength(
      normalizedName,
      Math.max(1, SKILL_NAME_MAX_LENGTH - suffix.length)
    )
    return `${truncatedName}${suffix}`
  }

  const markerWithSpacing = ` ${IMPORTED_SKILL_MARKER}`
  const truncatedName = truncateToLength(
    normalizedName,
    Math.max(1, SKILL_NAME_MAX_LENGTH - markerWithSpacing.length - suffix.length)
  )

  return `${truncatedName}${markerWithSpacing}${suffix}`
}

export function resolveImportedSkillName(name: string, usedNames: Iterable<string>): string {
  const normalizedName = normalizeInlineWhitespace(name)
  const usedNamesSet = new Set(Array.from(usedNames))

  if (!usedNamesSet.has(normalizedName)) {
    return normalizedName
  }

  let nextNumber = 1
  let candidate = buildImportedSkillName(normalizedName, nextNumber)

  while (usedNamesSet.has(candidate)) {
    nextNumber += 1
    candidate = buildImportedSkillName(normalizedName, nextNumber)
  }

  return candidate
}
