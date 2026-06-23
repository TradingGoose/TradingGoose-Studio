import { type MutableRefObject, useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type * as Y from 'yjs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { exportSkillsAsJson, SKILL_NAME_MAX_LENGTH } from '@/lib/skills/import-export'
import { useYjsStringField } from '@/lib/yjs/use-entity-fields'
import { isValidSkillName } from '@/hooks/queries/skills'
import { formatTemplate } from '@/i18n/utils'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'

const logger = createLogger('SkillEditor')

interface SkillEditorProps {
  skillId: string
  doc: Y.Doc | null
  save: () => Promise<void>
  exportRef: MutableRefObject<() => void>
  saveRef: MutableRefObject<() => void>
}

export function SkillEditor({ skillId, doc, save, exportRef, saveRef }: SkillEditorProps) {
  const copy = useWorkspaceWidgetsMessages().skillEditor
  const [name, setName] = useYjsStringField(doc, 'name')
  const [description, setDescription] = useYjsStringField(doc, 'description')
  const [content, setContent] = useYjsStringField(doc, 'content')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setError(null)
  }, [doc, skillId])

  const handleSave = useCallback(async () => {
    if (!doc) return

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedContent = content.trim()

    if (!trimmedName) {
      setError(copy.validation.nameRequired)
      return
    }

    if (!isValidSkillName(trimmedName)) {
      setError(formatTemplate(copy.validation.nameTooLong, { max: SKILL_NAME_MAX_LENGTH }))
      return
    }

    if (!trimmedDescription) {
      setError(copy.validation.descriptionRequired)
      return
    }

    if (!trimmedContent) {
      setError(copy.validation.contentRequired)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await save()
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : copy.validation.saveFailed
      logger.error('Failed to save skill', { error: saveError, skillId })
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }, [content, copy.validation, description, doc, name, save, skillId])

  const handleExport = useCallback(() => {
    if (!doc) return
    const json = exportSkillsAsJson({
      exportedFrom: 'skillEditor',
      skills: [{ name, description, content }],
    })
    const fileNameBase =
      name
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
        .replace(/\s+/g, '-') || 'skill'
    const blobUrl = URL.createObjectURL(
      new Blob([json], { type: 'application/json;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `${fileNameBase}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  }, [content, description, doc, name])

  useEffect(() => {
    exportRef.current = handleExport
  }, [exportRef, handleExport])

  useEffect(() => {
    saveRef.current = () => {
      void handleSave()
    }
  }, [handleSave, saveRef])

  return (
    <div className='flex h-full flex-col overflow-hidden'>
      <div className='flex-1 space-y-5 overflow-auto p-5'>
        <div className='space-y-2'>
          <Label htmlFor='skill-editor-name'>{copy.form.nameLabel}</Label>
          <Input
            id='skill-editor-name'
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy.form.namePlaceholder}
            disabled={!doc || isSaving}
            maxLength={SKILL_NAME_MAX_LENGTH}
          />
          <p className='text-muted-foreground text-xs'>{copy.form.helperText}</p>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='skill-editor-description'>{copy.form.descriptionLabel}</Label>
          <Input
            id='skill-editor-description'
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={copy.form.descriptionPlaceholder}
            disabled={!doc || isSaving}
            maxLength={1024}
          />
        </div>

        <div className='flex min-h-0 flex-1 flex-col space-y-2'>
          <Label htmlFor='skill-editor-content'>{copy.form.instructionsLabel}</Label>
          <Textarea
            id='skill-editor-content'
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={copy.form.instructionsPlaceholder}
            disabled={!doc || isSaving}
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
