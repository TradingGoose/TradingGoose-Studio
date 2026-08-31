'use client'

import { useState } from 'react'
import { Check, Copy, LibraryBig, Loader2, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CopyToWorkspace } from '@/app/workspace/[workspaceId]/knowledge/components/copy-to-workspace/copy-to-workspace'
import { Link } from '@/i18n/navigation'
import { useKnowledgeStore } from '@/stores/knowledge/store'

interface BaseOverviewProps {
  id?: string
  title: string
  description: string
  canEdit?: boolean
}

export function BaseOverview({ id, title, description, canEdit = true }: BaseOverviewProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const params = useParams()
  const t = useTranslations('workspace.knowledge.baseOverview')
  const workspaceSlug = params?.workspaceId as string
  const { removeKnowledgeBase } = useKnowledgeStore()
  const canManage = canEdit === true && !!id

  const searchParams = new URLSearchParams({
    kbName: title,
  })
  const href = `/workspace/${workspaceSlug}/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${searchParams.toString()}`

  const handleCopy = async () => {
    if (id) {
      try {
        await navigator.clipboard.writeText(id)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
      } catch (err) {
        console.error('Failed to copy ID:', err)
      }
    }
  }

  const handleDeleteKnowledgeBase = async () => {
    if (!id || !canManage) return
    try {
      setIsDeleting(true)
      const response = await fetch(`/api/knowledge/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete knowledge base')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete knowledge base')
      }

      removeKnowledgeBase(id)
      setIsDeleteDialogOpen(false)
    } catch (error) {
      console.error('Failed to delete knowledge base:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className='group relative flex h-full cursor-pointer flex-col gap-3 rounded-md border bg-card/40 p-4 transition-colors hover:bg-card'>
        <Link
          href={href}
          prefetch={true}
          aria-label={title}
          className='absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        />
        <div className='pointer-events-none relative z-10 flex items-start justify-between gap-3'>
          <div className='flex items-center gap-2'>
            <LibraryBig className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
            <h3 className='truncate font-medium text-sm leading-tight'>{title}</h3>
          </div>
          {id && (
            <div className='pointer-events-auto flex items-center gap-1'>
              <CopyToWorkspace
                knowledgeBaseId={id}
                currentWorkspaceId={workspaceSlug}
                disabled={!canManage || isDeleting}
              />
              <button
                type='button'
                aria-label={t('deleteButtonLabel')}
                className='inline-flex h-7 w-7 items-center justify-center gap-2 rounded-md p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={!canManage || isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Trash2 className='h-3.5 w-3.5' />
                )}
                <span className='sr-only'>{t('deleteButtonLabel')}</span>
              </button>
            </div>
          )}
        </div>

        <div className='pointer-events-none relative z-10 flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-muted-foreground text-xs'>
            <div className='flex items-center gap-2'>
              <span className='truncate font-mono'>{id?.slice(0, 8)}</span>
              <button
                type='button'
                aria-label={t('copyId')}
                onClick={handleCopy}
                className='pointer-events-auto flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              >
                {isCopied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
              </button>
            </div>
          </div>

          <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
            {description}
          </p>
        </div>
      </div>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open, details) => {
          if (!open && isDeleting) return details.cancel()
          setIsDeleteDialogOpen((prev) => (prev === open ? prev : open))
        }}
      >
        <AlertDialogContent hideCloseButton={isDeleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription', { title })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
            <Button
              type='button'
              onClick={() => void handleDeleteKnowledgeBase()}
              disabled={isDeleting}
              aria-busy={isDeleting || undefined}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? t('deleting') : t('deleteConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
