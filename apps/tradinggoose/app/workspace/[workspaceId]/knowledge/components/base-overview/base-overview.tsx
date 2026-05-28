'use client'

import { type KeyboardEvent, type MouseEvent, type SyntheticEvent, useState } from 'react'
import { Check, Copy, LibraryBig, Loader2, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
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
import { CopyToWorkspace } from '@/app/workspace/[workspaceId]/knowledge/components/copy-to-workspace/copy-to-workspace'
import { useKnowledgeStore } from '@/stores/knowledge/store'
import { Link } from '@/i18n/navigation'

interface BaseOverviewProps {
  id?: string
  title: string
  docCount: number
  description: string
  createdAt?: string
  updatedAt?: string
  canEdit?: boolean
}

function formatRelativeTime(dateString: string, locale: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diffInSeconds < 60) {
    return rtf.format(0, 'second')
  }
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return rtf.format(-minutes, 'minute')
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return rtf.format(-hours, 'hour')
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return rtf.format(-days, 'day')
  }
  if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800)
    return rtf.format(-weeks, 'week')
  }
  if (diffInSeconds < 31536000) {
    const months = Math.floor(diffInSeconds / 2592000)
    return rtf.format(-months, 'month')
  }
  const years = Math.floor(diffInSeconds / 31536000)
  return rtf.format(-years, 'year')
}

function formatAbsoluteDate(dateString: string, locale: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BaseOverview({
  id,
  title,
  docCount,
  description,
  createdAt,
  updatedAt,
  canEdit = true,
}: BaseOverviewProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const params = useParams()
  const locale = useLocale()
  const t = useTranslations('workspace.knowledge.baseOverview')
  const workspaceSlug = params?.workspaceId as string
  const { removeKnowledgeBase } = useKnowledgeStore()
  const canManage = canEdit === true && !!id

  const searchParams = new URLSearchParams({
    kbName: title,
  })
  const href = `/workspace/${workspaceSlug}/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${searchParams.toString()}`

  const handleCopy = async (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

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

  const handleActionClick = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleActionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
    }
    event.stopPropagation()
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
      <Link href={href} prefetch={true} className='block h-full'>
        <div className='group flex h-full cursor-pointer flex-col gap-3 rounded-md border bg-card/40 p-4 transition-colors hover:bg-card'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex items-center gap-2'>
              <LibraryBig className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
              <h3 className='truncate font-medium text-sm leading-tight'>{title}</h3>
            </div>
            {id && (
              <div
                className='flex items-center gap-1'
                onClick={handleActionClick}
                onKeyDown={handleActionKeyDown}
              >
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

          <div className='flex flex-col gap-2'>
            <div className='flex items-center gap-2 text-muted-foreground text-xs'>
              <span>
                {docCount} {docCount === 1 ? t('docsSingular') : t('docsPlural')}
              </span>
              <span>•</span>
              <div className='flex items-center gap-2'>
                <span className='truncate font-mono'>{id?.slice(0, 8)}</span>
                <button
                  onClick={handleCopy}
                  className='flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                >
                  {isCopied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
                </button>
              </div>
            </div>

            {/* Timestamps */}
            {(createdAt || updatedAt) && (
              <div className='flex items-center gap-2 text-muted-foreground text-xs'>
                {updatedAt && (
                  <span title={`${t('updated')}: ${formatAbsoluteDate(updatedAt, locale)}`}>
                    {t('updated')} {formatRelativeTime(updatedAt, locale)}
                  </span>
                )}
                {updatedAt && createdAt && <span>•</span>}
                {createdAt && (
                  <span title={`${t('created')}: ${formatAbsoluteDate(createdAt, locale)}`}>
                    {t('created')} {formatRelativeTime(createdAt, locale)}
                  </span>
                )}
              </div>
            )}

            <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
              {description}
            </p>
          </div>
        </div>
      </Link>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!isDeleting) {
            setIsDeleteDialogOpen((prev) => (prev === open ? prev : open))
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', {
                title,
                count: docCount,
                plural: docCount === 1 ? '' : 's',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKnowledgeBase}
              disabled={isDeleting}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? t('deleting') : t('deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
