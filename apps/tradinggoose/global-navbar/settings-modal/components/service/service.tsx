'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Skeleton,
} from '@/components/ui'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type ServiceApiKey,
  type ServiceKeyKind,
  serviceKeyMutationOptions,
  useServiceKeys,
} from '@/hooks/queries/service-keys'

const logger = createLogger('ServiceApiKeysSettings')

export function Service() {
  if (!isHosted) {
    return null
  }

  return (
    <div className='h-full px-6 py-4'>
      <div className='grid gap-4 md:grid-cols-2'>
        <ServiceKeyPanel service='copilot' />
        <ServiceKeyPanel service='market' />
      </div>
    </div>
  )
}

function ServiceKeyPanel({ service }: { service: ServiceKeyKind }) {
  const t = useTranslations('workspace.settingsModal.service')
  const queryClient = useQueryClient()
  const keysQuery = useServiceKeys(service)
  const keys = keysQuery.data ?? []
  const generateKey = useMutation(serviceKeyMutationOptions.generate(queryClient, service))
  const deleteKeyMutation = useMutation(serviceKeyMutationOptions.delete(queryClient, service))

  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyCopySuccess, setNewKeyCopySuccess] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ServiceApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [activeAction, setActiveAction] = useState<'generate' | 'delete' | null>(null)
  const [actionError, setActionError] = useState<{
    action: 'generate' | 'delete'
    message: string
  } | null>(null)
  const actionLockRef = useRef(false)
  const isPending = activeAction !== null || generateKey.isPending || deleteKeyMutation.isPending

  const onGenerate = async () => {
    if (actionLockRef.current || isPending) return

    actionLockRef.current = true
    setActiveAction('generate')
    setActionError(null)
    try {
      const data = await generateKey.mutateAsync()
      if (data.key.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
      }
    } catch (error) {
      logger.error(`Failed to generate ${service} API key`, { error })
      setActionError({ action: 'generate', message: t('generateError') })
    } finally {
      actionLockRef.current = false
      setActiveAction(null)
    }
  }

  const onDelete = async (id: string) => {
    if (actionLockRef.current || isPending) return

    actionLockRef.current = true
    setActiveAction('delete')
    setActionError(null)
    try {
      await deleteKeyMutation.mutateAsync({ keyId: id })
      setShowDeleteDialog(false)
      setDeleteKey(null)
    } catch (error) {
      logger.error(`Failed to delete ${service} API key`, { error })
      setActionError({ action: 'delete', message: t('deleteError') })
    } finally {
      actionLockRef.current = false
      setActiveAction(null)
    }
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNewKeyCopySuccess(true)
      setTimeout(() => setNewKeyCopySuccess(false), 1500)
    } catch (error) {
      logger.error(`Failed to copy ${service} API key`, { error })
    }
  }

  return (
    <div
      className='flex min-h-[260px] flex-col rounded-md border bg-background'
      aria-busy={keysQuery.isFetching || isPending || undefined}
    >
      <div className='flex items-center justify-between border-b px-4 py-3'>
        <div>
          <h3 className='font-semibold text-foreground text-sm'>{t(`${service}.title`)}</h3>
          <p className='text-muted-foreground text-xs'>{t(`${service}.description`)}</p>
        </div>
        <Button
          onClick={onGenerate}
          variant='ghost'
          size='sm'
          className='h-8 rounded-sm border bg-background px-3 shadow-xs hover:bg-card focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          disabled={keysQuery.isPending || keysQuery.isError || isPending}
          focusableWhenDisabled={activeAction === 'generate'}
          aria-busy={activeAction === 'generate' || undefined}
        >
          <Plus className='h-3.5 w-3.5 stroke-[2px]' />
          {activeAction === 'generate' ? t('creating') : t('create')}
        </Button>
      </div>

      <div className='flex-1 space-y-2 px-4 py-3'>
        {keysQuery.isPending ? (
          <div role='status' aria-atomic='true' className='space-y-2'>
            <span className='sr-only'>{t('loading')}</span>
            <ServiceKeySkeleton />
            <ServiceKeySkeleton />
          </div>
        ) : keysQuery.isError ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription className='flex items-center justify-between gap-3'>
              <span>{t('loadError')}</span>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => void keysQuery.refetch()}
                disabled={keysQuery.isFetching}
                aria-busy={keysQuery.isFetching || undefined}
              >
                {keysQuery.isFetching ? t('retrying') : t('retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : keys.length === 0 ? (
          <div className='py-3 text-center text-muted-foreground text-xs'>{t('noKeys')}</div>
        ) : (
          keys.map((key) => (
            <div key={key.id} className='flex items-center justify-between gap-4'>
              <div className='flex h-8 items-center rounded-sm bg-muted px-3'>
                <code className='font-mono text-foreground text-xs'>{key.displayKey}</code>
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  setDeleteKey(key)
                  setShowDeleteDialog(true)
                }}
                disabled={isPending}
                className='h-8 text-muted-foreground hover:text-foreground'
              >
                {t('delete')}
              </Button>
            </div>
          ))
        )}
        {actionError?.action === 'generate' ? (
          <Alert role='alert' variant='destructive'>
            <AlertDescription>{actionError.message}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <AlertDialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setNewKeyCopySuccess(false)
          }
        }}
      >
        <AlertDialogContent className='rounded-md sm:max-w-lg'>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('generateSuccessTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('generateSuccessDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {newKey ? (
            <div className='relative'>
              <div className='flex h-9 items-center rounded-md border-none bg-muted px-3 pr-8'>
                <code className='flex-1 truncate font-mono text-foreground text-sm'>{newKey}</code>
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='-translate-y-1/2 absolute top-1/2 right-2 h-4 w-4 rounded-sm p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                onClick={() => onCopy(newKey)}
              >
                {newKeyCopySuccess ? (
                  <Check className='!h-3.5 !w-3.5' />
                ) : (
                  <Copy className='!h-3.5 !w-3.5' />
                )}
                <span className='sr-only'>{t('copyToClipboard')}</span>
              </Button>
            </div>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open, details) => {
          if (!open && (actionLockRef.current || isPending)) return details.cancel()
          setShowDeleteDialog(open)
          if (!open) {
            setDeleteKey(null)
            setActionError(null)
          }
        }}
      >
        <AlertDialogContent className='rounded-md sm:max-w-md' hideCloseButton={isPending}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>

          {actionError?.action === 'delete' ? (
            <Alert role='alert' variant='destructive'>
              <AlertDescription>{actionError.message}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-sm'
              onClick={() => setDeleteKey(null)}
              disabled={isPending}
            >
              {t('cancel')}
            </AlertDialogCancel>
            <Button
              type='button'
              onClick={() => {
                if (deleteKey) void onDelete(deleteKey.id)
              }}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={isPending}
              focusableWhenDisabled={activeAction === 'delete'}
              aria-busy={activeAction === 'delete' || undefined}
            >
              {activeAction === 'delete' ? t('deleting') : t('delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ServiceKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-4'>
      <Skeleton className='h-8 w-24 rounded-sm' />
      <Skeleton className='h-8 w-16 rounded-sm' />
    </div>
  )
}
