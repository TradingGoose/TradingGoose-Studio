import { type MutableRefObject, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type * as Y from 'yjs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ENTITY_KIND_SKILL, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useYjsStringField } from '@/lib/yjs/use-entity-fields'
import { isValidSkillName, skillsKeys } from '@/hooks/queries/skills'
import { useSkillsStore } from '@/stores/skills/store'
import { SaveErrorAlert } from '@/widgets/widgets/components/save-error-alert'

const logger = createLogger('SkillEditor')

interface SkillEditorProps {
  workspaceId: string
  descriptor: ReviewTargetDescriptor
  saveRef: MutableRefObject<() => void>
  yjsDoc: Y.Doc
  onReviewTargetChange?: (descriptor: ReviewTargetDescriptor | null) => void
}

export function SkillEditor({
  workspaceId,
  descriptor,
  saveRef,
  yjsDoc,
  onReviewTargetChange,
}: SkillEditorProps) {
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const queryClient = useQueryClient()

  const [name, setName] = useYjsStringField(yjsDoc, 'name', '')
  const [description, setDescription] = useYjsStringField(yjsDoc, 'description', '')
  const [content, setContent] = useYjsStringField(yjsDoc, 'content', '')

  useEffect(() => {
    setError(null)
  }, [descriptor.reviewSessionId])

  const handleSave = useCallback(async () => {
    if (!descriptor.reviewSessionId) {
      setError('Missing review session.')
      return
    }

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedContent = content.trim()

    if (!trimmedName) {
      setError('Skill name is required.')
      return
    }

    if (!isValidSkillName(trimmedName)) {
      setError('Skill name must be kebab-case, for example market-research.')
      return
    }

    if (!trimmedDescription) {
      setError('Skill description is required.')
      return
    }

    if (!trimmedContent) {
      setError('Skill content is required.')
      return
    }

    const existingSkills = useSkillsStore.getState().getAllSkills(workspaceId)
    const isDuplicate = existingSkills.some((skill) => {
      if (descriptor.entityId && skill.id === descriptor.entityId) {
        return false
      }

      return skill.name === trimmedName
    })

    if (isDuplicate) {
      setError(`A skill named "${trimmedName}" already exists.`)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/copilot/review-entities/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityKind: ENTITY_KIND_SKILL,
          workspaceId,
          reviewSessionId: descriptor.reviewSessionId,
          draftSessionId: descriptor.draftSessionId ?? undefined,
          skill: {
            id: descriptor.entityId ?? undefined,
            name: trimmedName,
            description: trimmedDescription,
            content: trimmedContent,
          },
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save skill.')
      }

      queryClient.invalidateQueries({ queryKey: skillsKeys.list(workspaceId) })
      if (payload?.reviewTarget) {
        onReviewTargetChange?.(payload.reviewTarget as ReviewTargetDescriptor)
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save skill.'
      logger.error('Failed to save skill', {
        error: saveError,
        reviewSessionId: descriptor.reviewSessionId,
      })
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }, [
    content,
    descriptor.draftSessionId,
    descriptor.entityId,
    descriptor.reviewSessionId,
    name,
    description,
    onReviewTargetChange,
    queryClient,
    workspaceId,
  ])

  useEffect(() => {
    saveRef.current = () => {
      void handleSave()
    }
  }, [handleSave, saveRef])

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <Label htmlFor='skill-editor-name'>Name</Label>
          <Input
            id='skill-editor-name'
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder='market-research'
            disabled={isSaving}
            maxLength={64}
          />
          <p className='text-muted-foreground text-xs'>
            Use kebab-case. This is the identifier the agent uses when loading the skill.
          </p>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='skill-editor-description'>Description</Label>
          <Input
            id='skill-editor-description'
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder='What this skill helps the agent do'
            disabled={isSaving}
            maxLength={1024}
          />
        </div>

        <div className='flex min-h-0 flex-1 flex-col space-y-2'>
          <Label htmlFor='skill-editor-content'>Instructions</Label>
          <Textarea
            id='skill-editor-content'
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder='Write the skill instructions the agent should load.'
            disabled={isSaving}
            className='min-h-[320px] resize-y font-mono text-sm'
            maxLength={50000}
          />
        </div>

        <SaveErrorAlert error={error} />
      </div>
    </div>
  )
}
