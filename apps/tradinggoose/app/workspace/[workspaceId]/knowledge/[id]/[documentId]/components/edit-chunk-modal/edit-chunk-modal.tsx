'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MAX_CHUNK_CONTENT_LENGTH } from '@/lib/knowledge/chunks/types'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('EditChunkModal')
const CONTENT_ID = 'edit-chunk-content'
const CONTENT_CONSTRAINT_ID = 'edit-chunk-content-constraint'
const SUBMISSION_FAILURE_ID = 'edit-chunk-failure'

type EditChunkFailure = {
  kind: 'navigation' | 'submission'
  message: string
}

interface EditChunkModalProps {
  chunk: ChunkData | null
  document: DocumentData | null
  knowledgeBaseId: string
  isOpen: boolean
  onClose: () => void
  onChunkUpdate?: (updatedChunk: ChunkData) => void
  // New props for navigation
  allChunks?: ChunkData[]
  currentPage?: number
  totalPages?: number
  onNavigateToChunk?: (chunk: ChunkData) => void
  onNavigateToPage?: (page: number, selectChunk: 'first' | 'last') => Promise<void>
}

export function EditChunkModal({
  chunk,
  document,
  knowledgeBaseId,
  isOpen,
  onClose,
  onChunkUpdate,
  allChunks = [],
  currentPage = 1,
  totalPages = 1,
  onNavigateToChunk,
  onNavigateToPage,
}: EditChunkModalProps) {
  const userPermissions = useUserPermissionsContext()
  const t = useTranslations('workspace.knowledge.chunkModal')
  const [editedContent, setEditedContent] = useState(chunk?.content || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [failure, setFailure] = useState<EditChunkFailure | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  // Check if there are unsaved changes
  const hasUnsavedChanges = editedContent !== (chunk?.content || '')

  // Update edited content when chunk changes
  useEffect(() => {
    setEditedContent(chunk?.content ?? '')
    setFailure(null)
    setPendingNavigation(null)
    setShowUnsavedChangesAlert(false)
  }, [chunk?.id, chunk?.content, isOpen])

  // Find current chunk index in the current page
  const currentChunkIndex = chunk ? allChunks.findIndex((c) => c.id === chunk.id) : -1

  // Calculate navigation availability
  const canNavigatePrev = currentChunkIndex > 0 || currentPage > 1
  const canNavigateNext = currentChunkIndex < allChunks.length - 1 || currentPage < totalPages
  const contentConstraint = !userPermissions.canEdit
    ? null
    : editedContent.trim().length === 0
      ? t('contentConstraints.required')
      : editedContent.length > MAX_CHUNK_CONTENT_LENGTH
        ? t('contentConstraints.maxLength', { max: MAX_CHUNK_CONTENT_LENGTH })
        : null
  const contentDescriptionId = contentConstraint
    ? CONTENT_CONSTRAINT_ID
    : failure?.kind === 'submission'
      ? SUBMISSION_FAILURE_ID
      : undefined

  const handleSaveContent = async () => {
    if (!chunk || !document || contentConstraint) return

    try {
      setIsSaving(true)
      setFailure(null)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${document.id}/chunks/${chunk.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: editedContent,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || t('failures.failedToUpdateChunk'))
      }

      const result = await response.json()

      if (!result.success || !result.data) {
        throw new Error(result.error || t('failures.failedToUpdateChunk'))
      }

      onChunkUpdate?.(result.data)
      setFailure(null)
    } catch (err) {
      logger.error('Error updating chunk:', err)
      setFailure({
        kind: 'submission',
        message: err instanceof Error ? err.message : t('failures.generic'),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const navigateToChunk = async (direction: 'prev' | 'next') => {
    if (!chunk || isNavigating) return

    try {
      setIsNavigating(true)
      setFailure(null)

      if (direction === 'prev') {
        if (currentChunkIndex > 0) {
          // Navigate to previous chunk in current page
          const prevChunk = allChunks[currentChunkIndex - 1]
          onNavigateToChunk?.(prevChunk)
        } else if (currentPage > 1) {
          // Load previous page and navigate to last chunk
          await onNavigateToPage?.(currentPage - 1, 'last')
        }
      } else {
        if (currentChunkIndex < allChunks.length - 1) {
          // Navigate to next chunk in current page
          const nextChunk = allChunks[currentChunkIndex + 1]
          onNavigateToChunk?.(nextChunk)
        } else if (currentPage < totalPages) {
          // Load next page and navigate to first chunk
          await onNavigateToPage?.(currentPage + 1, 'first')
        }
      }
    } catch (err) {
      logger.error(`Error navigating ${direction}:`, err)
      setFailure({
        kind: 'navigation',
        message:
          direction === 'prev'
            ? t('failures.failedToNavigatePrev')
            : t('failures.failedToNavigateNext'),
      })
    } finally {
      setIsNavigating(false)
    }
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (hasUnsavedChanges) {
      setPendingNavigation(() => () => navigateToChunk(direction))
      setShowUnsavedChangesAlert(true)
    } else {
      void navigateToChunk(direction)
    }
  }

  const handleCloseAttempt = () => {
    if (isSaving || isNavigating) return false

    if (hasUnsavedChanges) {
      setPendingNavigation(null)
      setShowUnsavedChangesAlert(true)
      return false
    }
    resetAndClose()
    return true
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    if (pendingNavigation) {
      void pendingNavigation()
      setPendingNavigation(null)
    } else {
      resetAndClose()
    }
  }

  const isFormValid = contentConstraint === null

  function resetAndClose() {
    setEditedContent(chunk?.content ?? '')
    setFailure(null)
    setPendingNavigation(null)
    setShowUnsavedChangesAlert(false)
    onClose()
  }

  if (!chunk || !document) return null

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) return
          if (!handleCloseAttempt()) details.cancel()
        }}
      >
        <DialogContent
          className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <DialogTitle className='font-medium text-lg'>{t('editTitle')}</DialogTitle>

                {/* Navigation Controls */}
                <div className='flex items-center gap-1'>
                  <Tooltip>
                    <TooltipTrigger
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                      render={
                        <Button
                          variant='ghost'
                          size='sm'
                          aria-label={t('previousChunk')}
                          onClick={() => handleNavigate('prev')}
                          disabled={!canNavigatePrev || isNavigating || isSaving}
                          className='h-8 w-8 p-0'
                        >
                          <ChevronUp className='h-4 w-4' />
                        </Button>
                      }
                    />
                    <TooltipContent side='bottom'>
                      {t('previousChunk')}{' '}
                      {currentPage > 1 && currentChunkIndex === 0 ? `(${t('previousPage')})` : ''}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger
                      onFocus={(e) => e.preventDefault()}
                      onBlur={(e) => e.preventDefault()}
                      render={
                        <Button
                          variant='ghost'
                          size='sm'
                          aria-label={t('nextChunk')}
                          onClick={() => handleNavigate('next')}
                          disabled={!canNavigateNext || isNavigating || isSaving}
                          className='h-8 w-8 p-0'
                        >
                          <ChevronDown className='h-4 w-4' />
                        </Button>
                      }
                    />
                    <TooltipContent side='bottom'>
                      {t('nextChunk')}{' '}
                      {currentPage < totalPages && currentChunkIndex === allChunks.length - 1
                        ? `(${t('nextPage')})`
                        : ''}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 p-0'
                onClick={handleCloseAttempt}
                disabled={isSaving || isNavigating}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>{t('close')}</span>
              </Button>
            </div>
          </DialogHeader>

          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
              <div className='flex min-h-full flex-col py-4'>
                {/* Document Info Section - Fixed at top */}
                <div className='flex-shrink-0 space-y-4'>
                  <div className='flex items-center gap-3 rounded-lg border bg-muted/30 p-4'>
                    <div className='min-w-0 flex-1'>
                      <p className='font-medium text-sm'>
                        {document?.filename || t('unknownDocument')}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {t('editingChunk', { index: chunk.chunkIndex, currentPage, totalPages })}
                      </p>
                    </div>
                  </div>

                  {failure ? (
                    <Alert variant='destructive' aria-atomic='true'>
                      <AlertDescription
                        id={failure.kind === 'submission' ? SUBMISSION_FAILURE_ID : undefined}
                      >
                        {failure.message}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>

                {/* Content Input Section - Expands to fill remaining space */}
                <div className='mt-4 flex flex-1 flex-col'>
                  <Label htmlFor={CONTENT_ID} className='mb-2 font-medium text-sm'>
                    {t('chunkContent')}
                  </Label>
                  <Textarea
                    id={CONTENT_ID}
                    value={editedContent}
                    onChange={(event) => {
                      setEditedContent(event.target.value)
                      setFailure(null)
                    }}
                    placeholder={
                      userPermissions.canEdit ? t('chunkContentPlaceholder') : t('readOnlyView')
                    }
                    className='flex-1 resize-none'
                    disabled={isSaving || isNavigating || !userPermissions.canEdit}
                    readOnly={!userPermissions.canEdit}
                    required={userPermissions.canEdit}
                    aria-invalid={contentConstraint ? 'true' : undefined}
                    aria-describedby={contentDescriptionId}
                  />
                  {contentConstraint ? (
                    <p id={CONTENT_CONSTRAINT_ID} className='mt-2 text-destructive text-xs'>
                      {contentConstraint}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className='mt-auto border-t px-6 pt-4 pb-6'>
              <div className='flex justify-between'>
                <Button
                  variant='outline'
                  onClick={handleCloseAttempt}
                  disabled={isSaving || isNavigating}
                >
                  {t('cancel')}
                </Button>
                {userPermissions.canEdit && (
                  <Button
                    onClick={handleSaveContent}
                    disabled={!isFormValid || isSaving || !hasUnsavedChanges || isNavigating}
                    className='bg-primary font-[480] shadow-[0_0_0_0_var(--primary)] transition-all duration-200 hover:bg-primary-hover '
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                        {t('saving')}
                      </>
                    ) : (
                      t('saveChanges')
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Alert */}
      <AlertDialog open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsavedChangesTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingNavigation
                ? t('unsavedChangesDescriptionNavigate')
                : t('unsavedChangesDescriptionClose')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowUnsavedChangesAlert(false)
                setPendingNavigation(null)
              }}
            >
              {t('keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {t('discardChanges')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
