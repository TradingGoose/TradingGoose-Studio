'use client'

import { useLocale } from 'next-intl'
import { useState } from 'react'
import { Check, Copy, Plus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
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
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import {
  type ServiceApiKey,
  type ServiceKeyKind,
  useDeleteServiceKey,
  useGenerateServiceKey,
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
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.settingsModal.service[service]
  const serviceCopy = getPublicCopy(locale).workspace.settingsModal.service
  const { data: keys = [], isPending: isKeysPending } = useServiceKeys(service)
  const generateKey = useGenerateServiceKey(service)
  const deleteKeyMutation = useDeleteServiceKey(service)

  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyCopySuccess, setNewKeyCopySuccess] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ServiceApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const onGenerate = async () => {
    try {
      const data = await generateKey.mutateAsync()
      if (data.key.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
      }
    } catch (error) {
      logger.error(`Failed to generate ${service} API key`, { error })
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteKeyMutation.mutateAsync({ keyId: id })
    } catch (error) {
      logger.error(`Failed to delete ${service} API key`, { error })
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
    <div className='flex min-h-[260px] flex-col rounded-md border bg-background'>
      <div className='flex items-center justify-between border-b px-4 py-3'>
        <div>
          <h3 className='font-semibold text-foreground text-sm'>{copy.title}</h3>
          <p className='text-muted-foreground text-xs'>{copy.description}</p>
        </div>
        <Button
          onClick={onGenerate}
          variant='ghost'
          size='sm'
          className='h-8 rounded-sm border bg-background px-3 shadow-xs hover:bg-card focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          disabled={isKeysPending || generateKey.isPending || deleteKeyMutation.isPending}
        >
          <Plus className='h-3.5 w-3.5 stroke-[2px]' />
          {serviceCopy.create}
        </Button>
      </div>

      <div className='flex-1 space-y-2 px-4 py-3'>
        {isKeysPending ? (
          <>
            <ServiceKeySkeleton />
            <ServiceKeySkeleton />
          </>
        ) : keys.length === 0 ? (
          <div className='py-3 text-center text-muted-foreground text-xs'>{serviceCopy.noKeys}</div>
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
                className='h-8 text-muted-foreground hover:text-foreground'
              >
                {serviceCopy.delete}
              </Button>
            </div>
          ))
        )}
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
            <AlertDialogTitle>{serviceCopy.generateSuccessTitle}</AlertDialogTitle>
            <AlertDialogDescription>{serviceCopy.generateSuccessDescription}</AlertDialogDescription>
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
                <span className='sr-only'>{serviceCopy.copyToClipboard}</span>
              </Button>
            </div>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>{serviceCopy.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{serviceCopy.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' onClick={() => setDeleteKey(null)}>
              {serviceCopy.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteKey) {
                  onDelete(deleteKey.id)
                }
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={deleteKeyMutation.isPending}
            >
              {serviceCopy.delete}
            </AlertDialogAction>
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
