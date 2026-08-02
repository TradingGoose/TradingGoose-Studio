'use client'

import { useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
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
import { MAX_CHUNK_CONTENT_LENGTH } from '@/lib/knowledge/chunks/types'
import { createLogger } from '@/lib/logs/console/logger'
import type { ChunkData, DocumentData } from '@/stores/knowledge/store'

const logger = createLogger('CreateChunkModal')
const CONTENT_ID = 'create-chunk-content'
const CONTENT_CONSTRAINT_ID = 'create-chunk-content-constraint'
const SUBMISSION_FAILURE_ID = 'create-chunk-failure'

interface CreateChunkModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: DocumentData | null
  knowledgeBaseId: string
  onChunkCreated?: (chunk: ChunkData) => void
}

export function CreateChunkModal({
  open,
  onOpenChange,
  document,
  knowledgeBaseId,
  onChunkCreated,
}: CreateChunkModalProps) {
  const t = useTranslations('workspace.knowledge.chunkModal')
  const [content, setContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const isProcessingRef = useRef(false)

  const hasUnsavedChanges = content.trim().length > 0
  const contentConstraint =
    content.trim().length === 0
      ? t('contentConstraints.required')
      : content.length > MAX_CHUNK_CONTENT_LENGTH
        ? t('contentConstraints.maxLength', { max: MAX_CHUNK_CONTENT_LENGTH })
        : null
  const contentDescriptionId = contentConstraint
    ? CONTENT_CONSTRAINT_ID
    : failure
      ? SUBMISSION_FAILURE_ID
      : undefined

  const handleCreateChunk = async () => {
    if (!document || contentConstraint || isProcessingRef.current) {
      if (isProcessingRef.current) {
        logger.warn('Chunk creation already in progress, ignoring duplicate request')
      }
      return
    }

    try {
      isProcessingRef.current = true
      setIsCreating(true)
      setFailure(null)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${document.id}/chunks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
            enabled: true,
          }),
        }
      )

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || t('failures.failedToCreateChunk'))
      }

      const result = await response.json()

      if (result.success && result.data) {
        logger.info('Chunk created successfully:', result.data.id)

        if (onChunkCreated) {
          onChunkCreated(result.data)
        }

        onClose()
      } else {
        throw new Error(result.error || t('failures.failedToCreateChunk'))
      }
    } catch (err) {
      logger.error('Error creating chunk:', err)
      setFailure(err instanceof Error ? err.message : t('failures.generic'))
    } finally {
      isProcessingRef.current = false
      setIsCreating(false)
    }
  }

  const onClose = () => {
    onOpenChange(false)
    // Reset form state when modal closes
    setContent('')
    setFailure(null)
    setShowUnsavedChangesAlert(false)
  }

  const handleCloseAttempt = () => {
    if (isProcessingRef.current) return
    if (hasUnsavedChanges) {
      setShowUnsavedChangesAlert(true)
    } else {
      onClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowUnsavedChangesAlert(false)
    onClose()
  }

  const isFormValid = contentConstraint === null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) return
          if (isProcessingRef.current) {
            details.cancel()
            return
          }
          if (hasUnsavedChanges) details.cancel()
          handleCloseAttempt()
        }}
      >
        <DialogContent
          className='flex h-[74vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]'
          hideCloseButton
        >
          <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
            <div className='flex items-center justify-between'>
              <DialogTitle className='font-medium text-lg'>{t('createTitle')}</DialogTitle>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 p-0'
                onClick={handleCloseAttempt}
                disabled={isCreating}
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
                      <p className='text-muted-foreground text-xs'>{t('addingChunk')}</p>
                    </div>
                  </div>

                  {failure ? (
                    <Alert variant='destructive' aria-atomic='true'>
                      <AlertDescription id={SUBMISSION_FAILURE_ID}>{failure}</AlertDescription>
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
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value)
                      setFailure(null)
                    }}
                    placeholder={t('chunkContentPlaceholder')}
                    className='flex-1 resize-none'
                    disabled={isCreating}
                    required
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
                <Button variant='outline' onClick={handleCloseAttempt} disabled={isCreating}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={handleCreateChunk}
                  disabled={!isFormValid || isCreating}
                  className='bg-primary font-[480] text-primary-foreground shadow-[0_0_0_0_var(--primary)] transition-all duration-200 hover:bg-primary-hover '
                >
                  {isCreating ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {t('creating')}
                    </>
                  ) : (
                    t('createButton')
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Alert */}
      <AlertDialog open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardChangesTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardChangesDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowUnsavedChangesAlert(false)}>
              {t('keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDiscard}>
              {t('discardChanges')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
