'use client'

import { useEffect, useState } from 'react'
import { Eye, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MAX_TAG_SLOTS } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/use-knowledge-base-tag-definitions'
import { DocumentList } from './components/document-list'

const logger = createLogger('KnowledgeBaseTags')

// Predetermined colors for each tag slot (same as document tags)
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

interface KnowledgeBaseTagsProps {
  knowledgeBaseId: string
}

interface TagUsageData {
  tagName: string
  tagSlot: string
  documentCount: number
  documents: Array<{ id: string; name: string; tagValue: string }>
}

export function KnowledgeBaseTags({ knowledgeBaseId }: KnowledgeBaseTagsProps) {
  const { tagDefinitions: kbTagDefinitions, fetchTagDefinitions: refreshTagDefinitions } =
    useKnowledgeBaseTagDefinitions(knowledgeBaseId)
  const userPermissions = useUserPermissionsContext()
  const t = useTranslations('workspace.knowledge.tags')

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedTag, setSelectedTag] = useState<TagDefinition | null>(null)
  const [viewDocumentsDialogOpen, setViewDocumentsDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [tagUsageData, setTagUsageData] = useState<TagUsageData[]>([])
  const [isLoadingUsage, setIsLoadingUsage] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [createForm, setCreateForm] = useState({
    displayName: '',
    fieldType: 'text',
  })

  // Get color for a tag based on its slot
  const getTagColor = (slot: string) => {
    const slotMatch = slot.match(/tag(\d+)/)
    const slotNumber = slotMatch ? Number.parseInt(slotMatch[1]) - 1 : 0
    return TAG_SLOT_COLORS[slotNumber % TAG_SLOT_COLORS.length]
  }

  // Fetch tag usage data from API
  const fetchTagUsage = async () => {
    if (!knowledgeBaseId) return

    setIsLoadingUsage(true)
    try {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-usage`)
      if (!response.ok) {
        throw new Error('Failed to fetch tag usage')
      }
      const result = await response.json()
      if (result.success) {
        setTagUsageData(result.data)
      }
    } catch (error) {
      logger.error('Error fetching tag usage:', error)
    } finally {
      setIsLoadingUsage(false)
    }
  }

  // Load tag usage data when component mounts or knowledge base changes
  useEffect(() => {
    fetchTagUsage()
  }, [knowledgeBaseId])

  // Get usage data for a tag
  const getTagUsage = (tagName: string): TagUsageData => {
    return (
      tagUsageData.find((usage) => usage.tagName === tagName) || {
        tagName,
        tagSlot: '',
        documentCount: 0,
        documents: [],
      }
    )
  }

  const handleDeleteTag = async (tag: TagDefinition) => {
    setSelectedTag(tag)
    // Fetch fresh usage data before showing the delete dialog
    await fetchTagUsage()
    setDeleteDialogOpen(true)
  }

  const handleViewDocuments = async (tag: TagDefinition) => {
    setSelectedTag(tag)
    // Fetch fresh usage data before showing the view documents dialog
    await fetchTagUsage()
    setViewDocumentsDialogOpen(true)
  }

  const openTagCreator = () => {
    setCreateForm({
      displayName: '',
      fieldType: 'text',
    })
    setIsCreating(true)
  }

  const cancelCreating = () => {
    setCreateForm({
      displayName: '',
      fieldType: 'text',
    })
    setIsCreating(false)
  }

  const hasNameConflict = (name: string) => {
    if (!name.trim()) return false
    return kbTagDefinitions.some(
      (tag) => tag.displayName.toLowerCase() === name.trim().toLowerCase()
    )
  }

  // Check for conflicts in real-time during creation (but not while saving)
  const nameConflict = isCreating && !isSaving && hasNameConflict(createForm.displayName)

  const canSave = () => {
    return createForm.displayName.trim() && !hasNameConflict(createForm.displayName)
  }

  const saveTagDefinition = async () => {
    if (!canSave()) return

    setIsSaving(true)
    try {
      // Find next available slot
      const usedSlots = new Set(kbTagDefinitions.map((def) => def.tagSlot))
      const availableSlot = (
        ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'] as const
      ).find((slot) => !usedSlots.has(slot))

      if (!availableSlot) {
        throw new Error('No available tag slots')
      }

      // Create the tag definition
      const newTagDefinition = {
        tagSlot: availableSlot,
        displayName: createForm.displayName.trim(),
        fieldType: createForm.fieldType,
      }

      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-definitions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newTagDefinition),
      })

      if (!response.ok) {
        throw new Error('Failed to create tag definition')
      }

      // Refresh tag definitions and usage data
      await Promise.all([refreshTagDefinitions(), fetchTagUsage()])

      // Reset form and close creator
      setCreateForm({
        displayName: '',
        fieldType: 'text',
      })
      setIsCreating(false)
    } catch (error) {
      logger.error('Error creating tag definition:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDeleteTag = async () => {
    if (!selectedTag) return

    logger.info('Starting delete operation for:', selectedTag.displayName)
    setIsDeleting(true)

    try {
      logger.info('Calling delete API for tag:', selectedTag.displayName)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/tag-definitions/${selectedTag.id}`,
        {
          method: 'DELETE',
        }
      )

      logger.info('Delete API response status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Delete API failed:', errorText)
        throw new Error(`Failed to delete tag definition: ${response.status} ${errorText}`)
      }

      logger.info('Delete API successful, refreshing data...')

      // Refresh both tag definitions and usage data
      await Promise.all([refreshTagDefinitions(), fetchTagUsage()])

      logger.info('Data refresh complete, closing dialog')

      // Only close dialog and reset state after successful deletion and refresh
      setDeleteDialogOpen(false)
      setSelectedTag(null)

      logger.info('Delete operation completed successfully')
    } catch (error) {
      logger.error('Error deleting tag definition:', error)
      // Don't close dialog on error - let user see the error and try again or cancel
    } finally {
      logger.info('Setting isDeleting to false')
      setIsDeleting(false)
    }
  }

  // Don't show if user can't edit
  if (!userPermissions.canEdit) {
    return null
  }

  const selectedTagUsage = selectedTag ? getTagUsage(selectedTag.displayName) : null

  return (
    <>
      <div className='h-full w-full overflow-hidden'>
        <ScrollArea className='h-full' hideScrollbar={true}>
          <div className='px-2 py-2'>
            {/* KB Tag Definitions Section */}
            <div className='mb-1 space-y-1'>
              <div className='font-medium text-muted-foreground text-xs'>
                {t('knowledgeBaseTagsTitle')}
              </div>
              <div>
                {/* Existing Tag Definitions */}
                <div>
                  {kbTagDefinitions.length === 0 && !isCreating ? (
                    <div className='mb-1 rounded-md border border-dashed bg-card p-3 text-center'>
                        <p className='text-muted-foreground text-xs'>
                          {t('noTagDefinitionsYet')}
                          <br />
                        </p>
                    </div>
                  ) : (
                    kbTagDefinitions.length > 0 &&
                    kbTagDefinitions.map((tag, index) => {
                      const usage = getTagUsage(tag.displayName)
                      return (
                        <div key={tag.id} className='mb-1'>
                          <div className='cursor-default rounded-md border bg-card p-2 transition-colors'>
                            <div className='flex items-center justify-between text-sm'>
                              <div className='flex min-w-0 flex-1 items-center gap-2'>
                                <div
                                  className='h-2 w-2 rounded-full'
                                  style={{ backgroundColor: getTagColor(tag.tagSlot) }}
                                />
                                <div className='min-w-0 flex-1'>
                                  <div className='truncate font-medium'>{tag.displayName}</div>
                                </div>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-6 w-6 p-0 text-muted-foreground hover:text-foreground'
                                  >
                                    <MoreHorizontal className='h-3 w-3' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align='end'
                                  className='w-[180px] rounded-lg border bg-card shadow-xs'
                                >
                                  <DropdownMenuItem
                                    onClick={() => handleViewDocuments(tag)}
                                    className='cursor-pointer rounded-md px-3 py-2 text-sm hover:bg-secondary/50'
                                  >
                                    <Eye className='mr-2 h-3 w-3 flex-shrink-0' />
                                    <span className='whitespace-nowrap'>{t('viewDocuments')}</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteTag(tag)}
                                    className='cursor-pointer rounded-md px-3 py-2 text-red-600 text-sm hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950'
                                  >
                                    <Trash2 className='mr-2 h-3 w-3' />
                                    {t('deleteTag')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Add New Tag Button or Inline Creator */}
                {!isCreating && userPermissions.canEdit && (
                  <div className='mb-1'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={openTagCreator}
                      className='w-full justify-start gap-2 rounded-md border border-dashed bg-card text-muted-foreground hover:text-foreground'
                      disabled={kbTagDefinitions.length >= MAX_TAG_SLOTS}
                    >
                      <Plus className='h-4 w-4' />
                      {t('addTagDefinition')}
                    </Button>
                  </div>
                )}

                {/* Inline Tag Creation Form */}
                {isCreating && (
                  <div className='mb-1 w-full max-w-full space-y-2 rounded-md border bg-card p-2'>
                    <div className='space-y-1.5'>
                      <div className='flex items-center justify-between'>
                        <Label className='font-medium text-xs'>{t('tagName')}</Label>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={cancelCreating}
                          className='h-6 w-6 p-0 text-muted-foreground hover:text-red-600'
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      </div>
                      <Input
                        value={createForm.displayName}
                        onChange={(e) =>
                          setCreateForm({ ...createForm, displayName: e.target.value })
                        }
                        placeholder={t('enterTagName')}
                        className='h-8 w-full rounded-md text-sm'
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canSave()) {
                            e.preventDefault()
                            saveTagDefinition()
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelCreating()
                          }
                        }}
                      />
                      {nameConflict && (
                        <div className='text-red-600 text-xs'>
                          {t('tagNameExists')}
                        </div>
                      )}
                    </div>

                    <div className='space-y-1.5'>
                      <Label className='font-medium text-xs'>{t('type')}</Label>
                      <Select
                        value={createForm.fieldType}
                        onValueChange={(value) =>
                          setCreateForm({ ...createForm, fieldType: value })
                        }
                      >
                        <SelectTrigger className='h-8 w-full text-sm'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='text'>{t('text')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Action buttons */}
                    <div className='flex pt-1.5'>
                      <Button
                        size='sm'
                        onClick={saveTagDefinition}
                        className='h-7 w-full text-xs'
                        disabled={!canSave() || isSaving}
                      >
                        {isSaving ? t('creating') : t('save')}
                      </Button>
                    </div>
                  </div>
                )}

                <div className='mt-2 text-muted-foreground text-xs'>
                  {t('slotsUsed', { used: kbTagDefinitions.length, total: MAX_TAG_SLOTS })}
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTagTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <div className='mb-2'>
                  {t('deleteTagDescription', {
                    name: selectedTag?.displayName || '',
                    count: selectedTagUsage?.documentCount || 0,
                    plural: selectedTagUsage?.documentCount !== 1 ? 's' : '',
                  })}{' '}
                  <span className='text-red-500 dark:text-red-500'>
                    {t('thisActionCannotBeUndone')}
                  </span>
                </div>

                {selectedTagUsage && selectedTagUsage.documentCount > 0 && (
                  <div className='mt-4'>
                    <div className='mb-2 font-medium text-sm'>{t('affectedDocuments')}</div>
                    <DocumentList
                      documents={selectedTagUsage.documents}
                      totalCount={selectedTagUsage.documentCount}
                      maxHeight='max-h-32'
                    />
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              {t('cancel')}
            </AlertDialogCancel>
            <Button
              onClick={confirmDeleteTag}
              disabled={isDeleting}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              {isDeleting ? t('deleting') : t('deleteTag')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Documents Dialog */}
      <AlertDialog open={viewDocumentsDialogOpen} onOpenChange={setViewDocumentsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('documentsUsingTagTitle', { name: selectedTag?.displayName || '' })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <div className='mb-4 text-muted-foreground'>
                  {selectedTagUsage?.documentCount === 1
                    ? t('documentsUsingTagDescriptionSingular', {
                        count: selectedTagUsage?.documentCount || 0,
                      })
                    : t('documentsUsingTagDescriptionPlural', {
                        count: selectedTagUsage?.documentCount || 0,
                      })}
                </div>

                {selectedTagUsage?.documentCount === 0 ? (
                  <div className='rounded-md bg-muted/30 p-6 text-center'>
                    <div className='text-muted-foreground text-sm'>
                      {t('tagUnusedHelp')}
                    </div>
                  </div>
                ) : (
                  <DocumentList
                    documents={selectedTagUsage?.documents || []}
                    totalCount={selectedTagUsage?.documentCount || 0}
                    maxHeight='max-h-80'
                    showMoreText={false}
                  />
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
