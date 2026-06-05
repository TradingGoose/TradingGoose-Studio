'use client'

import { useState } from 'react'
import { ChevronDown, Info, Plus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { MAX_TAG_SLOTS, type TagSlot } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/use-knowledge-base-tag-definitions'
import { useNextAvailableSlot } from '@/hooks/use-next-available-slot'
import { type TagDefinitionInput, useTagDefinitions } from '@/hooks/use-tag-definitions'

const logger = createLogger('DocumentTagEntry')

export interface DocumentTag {
  slot: string
  displayName: string
  fieldType: string
  value: string
}

interface DocumentTagEntryProps {
  tags: DocumentTag[]
  onTagsChange: (newTags: DocumentTag[]) => void
  disabled?: boolean
  knowledgeBaseId: string
  documentId: string | null
  onSave?: (tagsToSave: DocumentTag[]) => Promise<void>
}

export function DocumentTagEntry({
  tags,
  onTagsChange,
  disabled = false,
  knowledgeBaseId,
  documentId,
  onSave,
}: DocumentTagEntryProps) {
  // Use different hooks based on whether we have a documentId
  const documentTagHook = useTagDefinitions(knowledgeBaseId, documentId)
  const kbTagHook = useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const { getNextAvailableSlot: getServerNextSlot } = useNextAvailableSlot(knowledgeBaseId)
  const t = useTranslations('workspace.knowledge.tags')

  // Use the document-level hook since we have documentId
  const { saveTagDefinitions } = documentTagHook
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } = kbTagHook

  // Modal state for tag editing
  const [editingTagIndex, setEditingTagIndex] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    displayName: '',
    fieldType: 'text',
    value: '',
  })

  const handleRemoveTag = async (index: number) => {
    const updatedTags = tags.filter((_, i) => i !== index)
    onTagsChange(updatedTags)

    // Persist the changes if onSave is provided
    if (onSave) {
      try {
        await onSave(updatedTags)
      } catch (error) {
        // Handle error silently - the UI will show the optimistic update
        // but the user can retry if needed
      }
    }
  }

  // Open modal to edit tag
  const openTagModal = (index: number) => {
    const tag = tags[index]
    setEditingTagIndex(index)
    setEditForm({
      displayName: tag.displayName,
      fieldType: tag.fieldType,
      value: tag.value,
    })
    setModalOpen(true)
  }

  // Open modal to create new tag
  const openNewTagModal = () => {
    setEditingTagIndex(null)
    setEditForm({
      displayName: '',
      fieldType: 'text',
      value: '',
    })
    setModalOpen(true)
  }

  // Save tag from modal
  const saveTagFromModal = async () => {
    if (!editForm.displayName.trim() || !editForm.value.trim()) return

    try {
      let targetSlot: string

      if (editingTagIndex !== null) {
        // EDIT MODE: Editing existing tag - use existing slot
        targetSlot = tags[editingTagIndex].slot
      } else {
        // CREATE MODE: Check if using existing definition or creating new one
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
        )

        if (existingDefinition) {
          // Using existing definition - use its slot
          targetSlot = existingDefinition.tagSlot
        } else {
          // Creating new definition - get next available slot from server
          const serverSlot = await getServerNextSlot(editForm.fieldType)
          if (!serverSlot) {
            throw new Error(`No available slots for new tag of type '${editForm.fieldType}'`)
          }
          targetSlot = serverSlot
        }
      }

      // Update the tags array
      if (editingTagIndex !== null) {
        // Editing existing tag
        const updatedTags = [...tags]
        updatedTags[editingTagIndex] = {
          ...updatedTags[editingTagIndex],
          displayName: editForm.displayName,
          fieldType: editForm.fieldType,
          value: editForm.value,
        }
        onTagsChange(updatedTags)
      } else {
        // Creating new tag
        const newTag: DocumentTag = {
          slot: targetSlot,
          displayName: editForm.displayName,
          fieldType: editForm.fieldType,
          value: editForm.value,
        }
        const newTags = [...tags, newTag]
        onTagsChange(newTags)
      }

      // Handle tag definition creation/update based on edit mode
      if (editingTagIndex !== null) {
        // EDIT MODE: Always update existing definition, never create new slots
        const currentTag = tags[editingTagIndex]
        const currentDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === currentTag.displayName.toLowerCase()
        )

        if (currentDefinition) {
          const updatedDefinition: TagDefinitionInput = {
            displayName: editForm.displayName,
            fieldType: currentDefinition.fieldType, // Keep existing field type (can't change in edit mode)
            tagSlot: currentDefinition.tagSlot, // Keep existing slot
            _originalDisplayName: currentTag.displayName, // Tell server which definition to update
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([updatedDefinition])
          } else {
            throw new Error('Cannot save tag definitions without a document ID')
          }
          await refreshTagDefinitions()

          // Update the document tag's display name
          const updatedTags = [...tags]
          updatedTags[editingTagIndex] = {
            ...currentTag,
            displayName: editForm.displayName,
            fieldType: currentDefinition.fieldType,
          }
          onTagsChange(updatedTags)
        }
      } else {
        // CREATE MODE: Adding new tag
        const existingDefinition = kbTagDefinitions.find(
          (def) => def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
        )

        if (!existingDefinition) {
          // Create new definition
          const newDefinition: TagDefinitionInput = {
            displayName: editForm.displayName,
            fieldType: editForm.fieldType,
            tagSlot: targetSlot as TagSlot,
          }

          if (saveTagDefinitions) {
            await saveTagDefinitions([newDefinition])
          } else {
            throw new Error('Cannot save tag definitions without a document ID')
          }
          await refreshTagDefinitions()
        }
        // If existingDefinition exists, use it (no server update needed)
      }

      // Save the actual document tags if onSave is provided
      if (onSave) {
        const updatedTags =
          editingTagIndex !== null
            ? tags.map((tag, index) =>
              index === editingTagIndex
                ? {
                  ...tag,
                  displayName: editForm.displayName,
                  fieldType: editForm.fieldType,
                  value: editForm.value,
                }
                : tag
            )
            : [
              ...tags,
              {
                slot: targetSlot,
                displayName: editForm.displayName,
                fieldType: editForm.fieldType,
                value: editForm.value,
              },
            ]
        await onSave(updatedTags)
      }

      setModalOpen(false)
    } catch (error) {
      logger.error('Error saving tag:', error)
    }
  }

  // Filter available tag definitions based on context
  const availableDefinitions = kbTagDefinitions.filter((def) => {
    if (editingTagIndex !== null) {
      // When editing, exclude only other used tag names (not the current one being edited)
      return !tags.some(
        (tag, index) =>
          index !== editingTagIndex &&
          tag.displayName.toLowerCase() === def.displayName.toLowerCase()
      )
    }
    // When creating new, exclude all already used tag names
    return !tags.some((tag) => tag.displayName.toLowerCase() === def.displayName.toLowerCase())
  })

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='font-medium text-sm'>{t('documentTagsTitle')}</h3>
      </div>

      {/* Tags as Badges */}
      <div className='flex flex-wrap gap-2'>
        {tags.map((tag, index) => (
          <Badge
            key={index}
            variant='outline'
            className='cursor-pointer gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-card'
            onClick={() => openTagModal(index)}
          >
            <span className='font-medium'>{tag.displayName || t('unnamedTag')}</span>
            {tag.value && (
              <>
                <span className='text-muted-foreground'>:</span>
                <span className='text-muted-foreground'>{tag.value}</span>
              </>
            )}
            <Button
              variant='ghost'
              size='sm'
              onClick={(e) => {
                e.stopPropagation()
                handleRemoveTag(index)
              }}
              disabled={disabled}
              className='ml-1 h-4 w-4 p-0 text-muted-foreground hover:text-red-600'
            >
              <X className='h-3 w-3' />
            </Button>
          </Badge>
        ))}

        {/* Add Tag Button */}
        <Button
          variant='outline'
          size='sm'
          onClick={openNewTagModal}
          disabled={disabled}
          className='gap-1 border-dashed text-muted-foreground hover:text-foreground'
        >
          <Plus className='h-4 w-4' />
          {t('addTag')}
        </Button>
      </div>

      {tags.length === 0 && (
        <div className='rounded-md border border-dashed p-4 text-center'>
          <p className='text-muted-foreground text-sm'>
            {t('emptyState')}
          </p>
        </div>
      )}

      <div className='text-muted-foreground text-xs'>
        {t('slotsUsed', { used: kbTagDefinitions.length, total: MAX_TAG_SLOTS })}
      </div>

      {/* Tag Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{editingTagIndex !== null ? t('editTag') : t('addNewTag')}</DialogTitle>
          </DialogHeader>

          <div className='space-y-4'>
            {/* Tag Name */}
            <div className='space-y-2'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='tag-name'>{t('tagName')}</Label>
                {editingTagIndex !== null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className='h-4 w-4 cursor-help text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                          <p className='text-sm'>{t('tagNameChangeWarning')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <div className='flex gap-2'>
                <Input
                  id='tag-name'
                  value={editForm.displayName}
                  onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  placeholder={t('enterTagName')}
                  className='flex-1'
                />
                {editingTagIndex === null && availableDefinitions.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='outline' size='sm'>
                        <ChevronDown className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      {availableDefinitions.map((def) => (
                        <DropdownMenuItem
                          key={def.id}
                          onClick={() =>
                            setEditForm({
                              ...editForm,
                              displayName: def.displayName,
                              fieldType: def.fieldType,
                            })
                          }
                        >
                          {def.displayName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Tag Type */}
            <div className='space-y-2'>
              <Label htmlFor='tag-type'>{t('type')}</Label>
              <Select
                value={editForm.fieldType}
                onValueChange={(value) => setEditForm({ ...editForm, fieldType: value })}
                disabled={editingTagIndex !== null} // Disable in edit mode
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='text'>{t('text')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tag Value */}
            <div className='space-y-2'>
              <Label htmlFor='tag-value'>{t('value')}</Label>
              <Input
                id='tag-value'
                value={editForm.value}
                onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                placeholder={t('enterTagValue')}
              />
            </div>
          </div>

          {/* Show warning when at max slots in create mode */}
          {editingTagIndex === null && kbTagDefinitions.length >= MAX_TAG_SLOTS && (
            <div className='rounded-md border border-yellow-200 bg-yellow-50 p-3'>
              <div className='flex items-center gap-2 text-yellow-800 text-sm'>
                <span className='font-medium'>{t('maximumTagDefinitionsReached')}</span>
              </div>
              <p className='mt-1 text-yellow-700 text-xs'>
                {t('maximumTagDefinitionsHelp')}
              </p>
            </div>
          )}

          <div className='flex justify-end gap-2 pt-4'>
            <Button variant='outline' onClick={() => setModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={saveTagFromModal}
              disabled={(() => {
                if (!editForm.displayName.trim()) return true

                // In edit mode, always allow
                if (editingTagIndex !== null) return false

                // In create mode, check if we're creating a new definition at max slots
                const existingDefinition = kbTagDefinitions.find(
                  (def) => def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
                )

                // If using existing definition, allow
                if (existingDefinition) return false

                // If creating new definition and at max slots, disable
                return kbTagDefinitions.length >= MAX_TAG_SLOTS
              })()}
            >
              {(() => {
                if (editingTagIndex !== null) {
                  return t('saveChanges')
                }

                const existingDefinition = kbTagDefinitions.find(
                  (def) => def.displayName.toLowerCase() === editForm.displayName.toLowerCase()
                )

                if (existingDefinition) {
                  return t('useExistingTag')
                }
                if (kbTagDefinitions.length >= MAX_TAG_SLOTS) {
                  return t('maxTagsReached')
                }
                return t('createNewTag')
              })()}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
