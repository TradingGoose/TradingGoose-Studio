import { type MutableRefObject, useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import { isValidSkillName, useUpdateSkill } from '@/hooks/queries/skills'
import { useSkillsStore } from '@/stores/skills/store'

const logger = createLogger('SkillEditor')

interface SkillInitialValues {
  id: string
  name: string
  description: string
  content: string
}

interface SkillEditorProps {
  workspaceId: string
  initialValues: SkillInitialValues
  saveRef: MutableRefObject<() => void>
  onDirtyChange?: (isDirty: boolean) => void
}

export function SkillEditor({
  workspaceId,
  initialValues,
  saveRef,
  onDirtyChange,
}: SkillEditorProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedValues, setSavedValues] = useState({
    name: '',
    description: '',
    content: '',
  })

  const updateSkillMutation = useUpdateSkill()

  useEffect(() => {
    const nextSavedValues = {
      name: initialValues.name,
      description: initialValues.description,
      content: initialValues.content,
    }

    setName(nextSavedValues.name)
    setDescription(nextSavedValues.description)
    setContent(nextSavedValues.content)
    setSavedValues(nextSavedValues)
    setError(null)
  }, [initialValues.content, initialValues.description, initialValues.id, initialValues.name])

  useEffect(() => {
    onDirtyChange?.(
      name !== savedValues.name ||
        description !== savedValues.description ||
        content !== savedValues.content
    )
  }, [
    content,
    description,
    name,
    onDirtyChange,
    savedValues.content,
    savedValues.description,
    savedValues.name,
  ])

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedContent = content.trim()

    if (!trimmedName) {
      setError('Skill name is required.')
      return
    }

    if (!isValidSkillName(trimmedName)) {
      setError(`Skill name must be ${SKILL_NAME_MAX_LENGTH} characters or fewer.`)
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
      if (skill.id === initialValues.id) {
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
      await updateSkillMutation.mutateAsync({
        workspaceId,
        skillId: initialValues.id,
        updates: {
          name: trimmedName,
          description: trimmedDescription,
          content: trimmedContent,
        },
      })

      setName(trimmedName)
      setDescription(trimmedDescription)
      setContent(trimmedContent)
      setSavedValues({
        name: trimmedName,
        description: trimmedDescription,
        content: trimmedContent,
      })
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save skill.'
      logger.error('Failed to save skill', { error: saveError, skillId: initialValues.id })
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }, [content, description, initialValues.id, name, updateSkillMutation, workspaceId])

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
            placeholder='Market Research'
            disabled={isSaving}
            maxLength={SKILL_NAME_MAX_LENGTH}
          />
          <p className='text-muted-foreground text-xs'>
            Use a clear workspace-unique name. Imported duplicates are renamed automatically.
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

        {error ? (
          <div className='flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm'>
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
