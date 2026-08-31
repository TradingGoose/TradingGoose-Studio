'use client'

import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MAX_TAG_SLOTS, TAG_SLOTS, type TagSlot } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/use-knowledge-base-tag-definitions'
import { useNextAvailableSlot } from '@/hooks/use-next-available-slot'
import { useTagDefinitions } from '@/hooks/use-tag-definitions'
import { type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'

const logger = createLogger('KnowledgeTags')

interface KnowledgeTagsProps {
  knowledgeBaseId: string
  documentId: string
}

interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

type TagSaveState = 'idle' | 'saving' | 'error' | 'success'

// Predetermined colors for each tag slot
const TAG_SLOT_COLORS = [
  'var(--primary)', // Purple
  '#FF6B35', // Orange
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#FF7675', // Red
  '#74B9FF', // Light Blue
  '#A29BFE', // Lavender
] as const

export function KnowledgeTags({ knowledgeBaseId, documentId }: KnowledgeTagsProps) {
  const { getCachedDocuments, updateDocument: updateDocumentInStore } = useKnowledgeStore()
  const userPermissions = useUserPermissionsContext()
  const t = useTranslations('workspace.knowledge.tags')
  const fieldIdPrefix = useId()

  // Use different hooks based on whether we have a documentId
  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const { getNextAvailableSlot: getServerNextSlot } = useNextAvailableSlot(knowledgeBaseId)

  // Use the document-level hook since we have documentId
  const { saveTagDefinitions, tagDefinitions, fetchTagDefinitions } = documentTagHook
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } = kbTagHook
  const tagDefinitionError = documentTagHook.error || kbTagHook.error
  const tagDefinitionsLoading = documentTagHook.isLoading || kbTagHook.isLoading

  const [documentTags, setDocumentTags] = useState<DocumentTag[]>([])
  const [documentData, setDocumentData] = useState<DocumentData | null>(null)
  const [isLoadingDocument, setIsLoadingDocument] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Inline editing state
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [saveState, setSaveState] = useState<TagSaveState>('idle')
  const saveInFlightRef = useRef(false)
  const isSubmitting = saveState === 'saving'
  const [editForm, setEditForm] = useState({
    displayName: '',
    fieldType: 'text',
    value: '',
  })
  const updateEditForm = (updates: Partial<typeof editForm>) => {
    if (isSubmitting) return
    setSaveState('idle')
    setEditForm((current) => ({ ...current, ...updates }))
  }

  // Function to build document tags from data and definitions
  const buildDocumentTags = useCallback(
    (docData: DocumentData, definitions: TagDefinition[], currentTags?: DocumentTag[]) => {
      const tags: DocumentTag[] = []
      const tagSlots = TAG_SLOTS

      tagSlots.forEach((slot) => {
        const value = docData[slot] as string | null | undefined
        const definition = definitions.find((def) => def.tagSlot === slot)
        const currentTag = currentTags?.find((tag) => tag.slot === slot)

        // Only include tag if the document has a value AND a corresponding KB tag definition exists
        if (value?.trim() && definition) {
          tags.push({
            slot,
            displayName: definition.displayName,
            fieldType: definition.fieldType,
            value: value.trim(),
          })
        }
      })

      return tags
    },
    []
  )

  // Handle tag updates (local state only, no API calls)
  const handleTagsChange = useCallback((newTags: DocumentTag[]) => {
    // Only update local state, don't save to API
    setDocumentTags(newTags)
  }, [])

  // Handle saving document tag values to the API
  const handleSaveDocumentTags = useCallback(
    async (tagsToSave: DocumentTag[]) => {
      if (!documentData) return

      try {
        // Convert DocumentTag array to tag data for API
        const tagData: Record<string, string> = {}
        const tagSlots = TAG_SLOTS

        // Clear all tags first
        tagSlots.forEach((slot) => {
          tagData[slot] = ''
        })

        // Set values from tagsToSave
        tagsToSave.forEach((tag) => {
          if (tag.value.trim()) {
            tagData[tag.slot] = tag.value.trim()
          }
        })

        // Update document via API
        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tagData),
        })

        if (!response.ok) {
          throw new Error('Failed to update document tags')
        }

        // Update the document in the store and local state
        updateDocumentInStore(knowledgeBaseId, documentId, tagData)
        setDocumentData((prev) => (prev ? { ...prev, ...tagData } : null))
      } catch (error) {
        logger.error('Error updating document tags:', error)
        throw error // Re-throw so the component can handle it
      }
    },
    [documentData, knowledgeBaseId, documentId, updateDocumentInStore]
  )

  // Handle removing a tag
  const handleRemoveTag = async (index: number) => {
    const updatedTags = documentTags.filter((_, i) => i !== index)
    handleTagsChange(updatedTags)

    // Persist the changes
    try {
      await handleSaveDocumentTags(updatedTags)
    } catch (error) {
      // Handle error silently - the UI will show the optimistic update
      // but the user can retry if needed
    }
  }

  // Toggle inline editor for existing tag
  const toggleTagEditor = (index: number) => {
    if (isSubmitting) return
    setSaveState('idle')
    if (editingTagIndex === index) {
      // Already editing this tag - collapse it
      cancelEditing()
    } else {
      // Start editing this tag
      const tag = documentTags[index]
      setEditingTagIndex(index)
      setEditForm({
        displayName: tag.displayName,
        fieldType: tag.fieldType,
        value: tag.value,
      })
      setIsCreating(false)
    }
  }

  // Open inline creator for new tag
  const openTagCreator = () => {
    if (isSubmitting) return
    setSaveState('idle')
    setEditingTagIndex(null)
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setIsCreating(true)
  }

  // Save tag (create or edit)
  const saveTag = async () => {
    if (saveInFlightRef.current || !canSubmitTag) return
    saveInFlightRef.current = true

    try {
      const formData = { ...editForm }
      const currentEditingIndex = editingTagIndex
      const originalTag = currentEditingIndex !== null ? documentTags[currentEditingIndex] : null
      setSaveState('saving')
      let targetSlot: string
      let definitionChanged = false

      if (currentEditingIndex !== null && originalTag) {
        const currentDefinition = kbTagDefinitions.find(
          (definition) => definition.tagSlot === originalTag.slot
        )
        if (!currentDefinition) throw new Error('Tag definition not found')
        targetSlot = currentDefinition.tagSlot

        if (currentDefinition.displayName !== formData.displayName) {
          const result = await saveTagDefinitions([
            {
              displayName: formData.displayName,
              fieldType: currentDefinition.fieldType,
              tagSlot: currentDefinition.tagSlot,
              _originalDisplayName: currentDefinition.displayName,
            },
          ])
          const updatedDefinition = result.updated[0]
          if (!updatedDefinition) throw new Error('Updated tag definition missing from response')
          targetSlot = updatedDefinition.tagSlot
          definitionChanged = true
        }
      } else {
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === formData.displayName.toLowerCase()
        )

        if (existingDefinition) {
          targetSlot = existingDefinition.tagSlot
        } else {
          const serverSlot = await getServerNextSlot(formData.fieldType)
          if (!serverSlot) {
            throw new Error(`No available slots for new tag of type '${formData.fieldType}'`)
          }
          const result = await saveTagDefinitions([
            {
              displayName: formData.displayName,
              fieldType: formData.fieldType,
              tagSlot: serverSlot as TagSlot,
            },
          ])
          const createdDefinition = result.created[0]
          if (!createdDefinition) throw new Error('Created tag definition missing from response')
          targetSlot = createdDefinition.tagSlot
          definitionChanged = true
        }
      }

      if (definitionChanged) {
        await Promise.all([fetchTagDefinitions(), refreshTagDefinitions()])
      }

      let updatedTags: DocumentTag[]
      if (currentEditingIndex !== null) {
        updatedTags = [...documentTags]
        updatedTags[currentEditingIndex] = {
          ...updatedTags[currentEditingIndex],
          displayName: formData.displayName,
          fieldType: formData.fieldType,
          value: formData.value,
        }
      } else {
        updatedTags = [
          ...documentTags,
          {
            slot: targetSlot,
            displayName: formData.displayName,
            fieldType: formData.fieldType,
            value: formData.value,
          },
        ]
      }

      await handleSaveDocumentTags(updatedTags)
      handleTagsChange(updatedTags)
      setEditingTagIndex(null)
      setIsCreating(false)
      setEditForm({
        displayName: '',
        fieldType: 'text',
        value: '',
      })
      setSaveState('success')
    } catch (error) {
      logger.error('Error saving tag:', error)
      setSaveState('error')
    } finally {
      saveInFlightRef.current = false
    }
  }

  const handleTagSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveTag()
  }

  // Check if tag name already exists on this document
  const hasNameConflict = (name: string) => {
    if (!name.trim()) return false

    return documentTags.some((tag, index) => {
      // When editing, don't consider the current tag being edited as a conflict
      if (editingTagIndex !== null && index === editingTagIndex) {
        return false
      }
      return tag.displayName.toLowerCase() === name.trim().toLowerCase()
    })
  }

  // Get color for a tag based on its slot
  const getTagColor = (slot: string) => {
    // Extract slot number from slot string (e.g., "tag1" -> 1, "tag2" -> 2, etc.)
    const slotMatch = slot.match(/tag(\d+)/)
    const slotNumber = slotMatch ? Number.parseInt(slotMatch[1]) - 1 : 0
    return TAG_SLOT_COLORS[slotNumber % TAG_SLOT_COLORS.length]
  }

  const cancelEditing = () => {
    if (isSubmitting) return
    setSaveState('idle')
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setEditingTagIndex(null)
    setIsCreating(false)
  }

  // Filter available tag definitions - exclude all used tag names on this document
  const availableDefinitions = kbTagDefinitions.filter((def) => {
    // Always exclude all already used tag names (including current tag being edited)
    return !documentTags.some(
      (tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase()
    )
  })

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setIsLoadingDocument(true)
        setError(null)

        const cachedDocuments = getCachedDocuments(knowledgeBaseId)
        const cachedDoc = cachedDocuments?.documents?.find((d) => d.id === documentId)

        if (cachedDoc) {
          setDocumentData(cachedDoc)
          // Initialize tags from cached document
          const initialTags = buildDocumentTags(cachedDoc, tagDefinitions)
          setDocumentTags(initialTags)
          setIsLoadingDocument(false)
          return
        }

        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Document not found')
          }
          throw new Error(`Failed to fetch document: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocumentData(result.data)
          // Initialize tags from fetched document
          const initialTags = buildDocumentTags(result.data, tagDefinitions, [])
          setDocumentTags(initialTags)
        } else {
          throw new Error(result.error || 'Failed to fetch document')
        }
      } catch (err) {
        logger.error('Error fetching document:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingDocument(false)
      }
    }

    if (knowledgeBaseId && documentId) {
      fetchDocument()
    }
  }, [knowledgeBaseId, documentId, getCachedDocuments, buildDocumentTags])

  // Separate effect to rebuild tags when tag definitions change (without re-fetching document)
  useEffect(() => {
    if (documentData && !isSubmitting) {
      const rebuiltTags = buildDocumentTags(documentData, tagDefinitions, documentTags)
      setDocumentTags(rebuiltTags)
    }
  }, [documentData, tagDefinitions, buildDocumentTags, isSubmitting])

  if (isLoadingDocument) {
    return (
      <div className='h-full'>
        <ScrollArea className='h-full' hideScrollbar={true}>
          <div className='px-2 py-2'>
            <div className='h-20 animate-pulse rounded-md bg-muted' />
          </div>
        </ScrollArea>
      </div>
    )
  }

  if (error || !documentData) {
    return null // Don't show anything if there's an error or no document
  }

  const isEditing = editingTagIndex !== null || isCreating
  const nameConflict = hasNameConflict(editForm.displayName)

  // Check if there are actual changes (for editing mode)
  const hasChanges = () => {
    if (editingTagIndex === null) return true // Creating new tag always has changes

    const originalTag = documentTags[editingTagIndex]
    if (!originalTag) return true

    return (
      originalTag.displayName !== editForm.displayName ||
      originalTag.value !== editForm.value ||
      originalTag.fieldType !== editForm.fieldType
    )
  }

  // Check if save should be enabled
  const matchingDefinition = kbTagDefinitions.find(
    (definition) =>
      definition.displayName.toLowerCase() === editForm.displayName.trim().toLowerCase()
  )
  const slotAvailable =
    editingTagIndex !== null ||
    kbTagDefinitions.length < MAX_TAG_SLOTS ||
    Boolean(matchingDefinition)
  const canSubmitTag = Boolean(
    !isSubmitting &&
      editForm.displayName.trim() &&
      editForm.value.trim() &&
      !nameConflict &&
      hasChanges() &&
      slotAvailable
  )
  const createNameId = `${fieldIdPrefix}-create-name`
  const createNameErrorId = `${createNameId}-error`
  const createTypeId = `${fieldIdPrefix}-create-type`
  const createValueId = `${fieldIdPrefix}-create-value`

  return (
    <div className='h-full w-full overflow-hidden' aria-busy={isSubmitting || undefined}>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='px-2 py-2'>
          <div className='mb-1 space-y-1'>
            <div className='font-medium text-muted-foreground text-xs'>
              {t('documentTagsTitle')}
            </div>
            {tagDefinitionError ? (
              <div className='space-y-2'>
                <p role='alert' aria-atomic='true' className='text-destructive text-xs'>
                  {t('definitionsLoadFailed')}
                </p>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={tagDefinitionsLoading}
                  focusableWhenDisabled={tagDefinitionsLoading}
                  aria-busy={tagDefinitionsLoading || undefined}
                  onClick={() => {
                    void Promise.all([fetchTagDefinitions(), refreshTagDefinitions()])
                  }}
                >
                  {tagDefinitionsLoading ? t('retrying') : t('retry')}
                </Button>
              </div>
            ) : tagDefinitionsLoading ? (
              <p
                role='status'
                aria-live='polite'
                aria-atomic='true'
                aria-busy='true'
                className='text-muted-foreground text-xs'
              >
                {t('loadingDefinitions')}
              </p>
            ) : null}
            {saveState !== 'idle' ? (
              <div
                className={
                  saveState === 'error'
                    ? 'text-destructive text-xs'
                    : 'text-muted-foreground text-xs'
                }
                role={saveState === 'error' ? 'alert' : 'status'}
                aria-atomic='true'
              >
                {saveState === 'saving'
                  ? t('savingTag')
                  : saveState === 'success'
                    ? t('tagSaved')
                    : t('tagSaveFailed')}
              </div>
            ) : null}
            <div>
              <div>
                {documentTags.map((tag, index) => {
                  const nameId = `${fieldIdPrefix}-${tag.slot}-name`
                  const nameErrorId = `${nameId}-error`
                  const typeId = `${fieldIdPrefix}-${tag.slot}-type`
                  const valueId = `${fieldIdPrefix}-${tag.slot}-value`

                  return (
                    <div
                      key={tag.slot}
                      className={`mb-1 rounded-md border bg-card transition-colors ${
                        editingTagIndex === index ? 'space-y-2 p-2' : 'p-2'
                      }`}
                    >
                      <div className='flex items-center justify-between gap-1 text-sm'>
                        {userPermissions.canEdit ? (
                          <button
                            type='button'
                            aria-expanded={editingTagIndex === index}
                            disabled={isSubmitting}
                            onClick={() => toggleTagEditor(index)}
                            className='flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          >
                            <span
                              className='h-2 w-2 rounded-full'
                              style={{ backgroundColor: getTagColor(tag.slot) }}
                            />
                            <span className='truncate font-medium'>{tag.displayName}</span>
                          </button>
                        ) : (
                          <div className='flex min-w-0 flex-1 items-center gap-2'>
                            <span
                              className='h-2 w-2 rounded-full'
                              style={{ backgroundColor: getTagColor(tag.slot) }}
                            />
                            <span className='truncate font-medium'>{tag.displayName}</span>
                          </div>
                        )}
                        {userPermissions.canEdit ? (
                          <Button
                            variant='ghost'
                            size='sm'
                            aria-label={t('removeTag', { name: tag.displayName })}
                            disabled={isSubmitting}
                            onClick={() => handleRemoveTag(index)}
                            className='h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                          >
                            <X className='h-3 w-3' />
                          </Button>
                        ) : null}
                      </div>

                      {editingTagIndex === index ? (
                        <form className='space-y-1.5' onSubmit={handleTagSubmit}>
                          <div className='space-y-1.5'>
                            <Label htmlFor={nameId} className='font-medium text-xs'>
                              {t('tagName')}
                            </Label>
                            <div className='flex gap-1.5'>
                              <Input
                                id={nameId}
                                value={editForm.displayName}
                                onChange={(event) =>
                                  updateEditForm({ displayName: event.target.value })
                                }
                                aria-invalid={nameConflict || undefined}
                                aria-describedby={nameConflict ? nameErrorId : undefined}
                                disabled={isSubmitting}
                                required={true}
                                placeholder={t('enterTagName')}
                                className='h-8 min-w-0 flex-1 rounded-md text-sm'
                                onKeyDown={(event) => {
                                  if (event.key === 'Escape') {
                                    event.preventDefault()
                                    cancelEditing()
                                  }
                                }}
                              />
                              {availableDefinitions.length > 0 ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        aria-label={t('useExistingTag')}
                                        disabled={isSubmitting}
                                        className='h-8 w-7 flex-shrink-0 p-0'
                                      />
                                    }
                                  >
                                    <ChevronDown className='h-3 w-3' />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align='end'
                                    className='w-[160px] rounded-lg border bg-card shadow-xs'
                                  >
                                    {availableDefinitions.map((definition) => (
                                      <DropdownMenuItem
                                        key={definition.id}
                                        onClick={() =>
                                          updateEditForm({
                                            displayName: definition.displayName,
                                            fieldType: definition.fieldType,
                                          })
                                        }
                                        className='cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-secondary/50'
                                      >
                                        {definition.displayName}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </div>
                            {nameConflict ? (
                              <div id={nameErrorId} className='text-red-600 text-xs'>
                                {t('tagNameExists')}
                              </div>
                            ) : null}
                          </div>

                          <div className='space-y-1.5'>
                            <Label htmlFor={typeId} className='font-medium text-xs'>
                              {t('type')}
                            </Label>
                            <Select
                              value={editForm.fieldType}
                              items={[{ value: 'text', label: t('text') }]}
                              onValueChange={(value) => {
                                if (value !== null) {
                                  updateEditForm({ fieldType: value })
                                }
                              }}
                              disabled
                            >
                              <SelectTrigger id={typeId} className='h-8 w-full text-sm'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='text'>{t('text')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className='space-y-1.5'>
                            <Label htmlFor={valueId} className='font-medium text-xs'>
                              {t('value')}
                            </Label>
                            <Input
                              id={valueId}
                              value={editForm.value}
                              onChange={(event) => updateEditForm({ value: event.target.value })}
                              disabled={isSubmitting}
                              required={true}
                              placeholder={t('enterTagValue')}
                              className='h-8 w-full rounded-md text-sm'
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelEditing()
                                }
                              }}
                            />
                          </div>

                          <div className='pt-1'>
                            <Button
                              type='submit'
                              size='sm'
                              className='h-7 w-full text-xs'
                              disabled={!canSubmitTag}
                            >
                              {t('saveChanges')}
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {documentTags.length === 0 && !isCreating && (
                <div className='mb-1 rounded-md border border-dashed bg-card p-3 text-center'>
                  <p className='text-muted-foreground text-xs'>{t('emptyState')}</p>
                </div>
              )}

              {!isEditing && userPermissions.canEdit && (
                <div className='mb-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={openTagCreator}
                    className='w-full justify-start gap-2 rounded-md border border-dashed bg-card text-muted-foreground hover:text-foreground'
                    disabled={
                      isSubmitting ||
                      (kbTagDefinitions.length >= MAX_TAG_SLOTS &&
                        availableDefinitions.length === 0)
                    }
                  >
                    <Plus className='h-4 w-4' />
                    {t('addTag')}
                  </Button>
                </div>
              )}

              {isCreating && (
                <form
                  className='mb-1 w-full max-w-full space-y-2 rounded-md border bg-card p-2'
                  onSubmit={handleTagSubmit}
                >
                  <div className='space-y-1.5'>
                    <div className='flex items-center justify-between'>
                      <Label htmlFor={createNameId} className='font-medium text-xs'>
                        {t('tagName')}
                      </Label>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        aria-label={t('cancel')}
                        disabled={isSubmitting}
                        onClick={cancelEditing}
                        className='h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                      >
                        <X className='h-3 w-3' />
                      </Button>
                    </div>
                    <div className='flex gap-1.5'>
                      <Input
                        id={createNameId}
                        value={editForm.displayName}
                        onChange={(event) => updateEditForm({ displayName: event.target.value })}
                        aria-invalid={nameConflict || undefined}
                        aria-describedby={nameConflict ? createNameErrorId : undefined}
                        disabled={isSubmitting}
                        required={true}
                        placeholder={t('enterTagName')}
                        className='h-8 min-w-0 flex-1 rounded-md text-sm'
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelEditing()
                          }
                        }}
                      />
                      {availableDefinitions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                type='button'
                                variant='outline'
                                size='sm'
                                aria-label={t('useExistingTag')}
                                disabled={isSubmitting}
                                className='h-8 w-7 flex-shrink-0 p-0'
                              />
                            }
                          >
                            <ChevronDown className='h-3 w-3' />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align='end'
                            className='w-[160px] rounded-lg border bg-card shadow-xs'
                          >
                            {availableDefinitions.map((def) => (
                              <DropdownMenuItem
                                key={def.id}
                                onClick={() =>
                                  updateEditForm({
                                    displayName: def.displayName,
                                    fieldType: def.fieldType,
                                  })
                                }
                                className='cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-secondary/50'
                              >
                                {def.displayName}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {nameConflict && (
                      <div id={createNameErrorId} className='text-red-600 text-xs'>
                        {t('tagNameExists')}
                      </div>
                    )}
                  </div>

                  <div className='space-y-1.5'>
                    <Label htmlFor={createTypeId} className='font-medium text-xs'>
                      {t('type')}
                    </Label>
                    <Select
                      value={editForm.fieldType}
                      items={[{ value: 'text', label: t('text') }]}
                      onValueChange={(value) => {
                        if (value !== null) updateEditForm({ fieldType: value })
                      }}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id={createTypeId} className='h-8 w-full text-sm'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='text'>{t('text')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-1.5'>
                    <Label htmlFor={createValueId} className='font-medium text-xs'>
                      {t('value')}
                    </Label>
                    <Input
                      id={createValueId}
                      value={editForm.value}
                      onChange={(event) => updateEditForm({ value: event.target.value })}
                      disabled={isSubmitting}
                      required={true}
                      placeholder={t('enterTagValue')}
                      className='h-8 w-full rounded-md text-sm'
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEditing()
                        }
                      }}
                    />
                  </div>

                  {kbTagDefinitions.length >= MAX_TAG_SLOTS && (
                    <div className='rounded-md border border-yellow-200 bg-yellow-50 p-2 dark:border-yellow-800 dark:bg-yellow-950'>
                      <div className='text-xs text-yellow-800 dark:text-yellow-200'>
                        <span className='font-medium'>{t('maximumTagDefinitionsReached')}</span>
                      </div>
                      <p className='text-xs text-yellow-700 dark:text-yellow-300'>
                        {t('maximumTagDefinitionsHelp')}
                      </p>
                    </div>
                  )}

                  <div className='pt-2'>
                    <Button
                      type='submit'
                      size='sm'
                      className='h-7 w-full text-xs'
                      disabled={!canSubmitTag}
                    >
                      {t('createNewTag')}
                    </Button>
                  </div>
                </form>
              )}

              <div className='mt-2 text-muted-foreground text-xs'>
                {t('slotsUsed', {
                  used: kbTagDefinitions.length,
                  total: MAX_TAG_SLOTS,
                })}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
