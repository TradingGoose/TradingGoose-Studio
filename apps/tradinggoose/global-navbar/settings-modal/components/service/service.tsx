'use client'

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
import {
  type ServiceApiKey,
  type ServiceKeyKind,
  useDeleteServiceKey,
  useGenerateServiceKey,
  useServiceKeys,
} from '@/hooks/queries/service-keys'

const logger = createLogger('ServiceApiKeysSettings')

const SERVICE_COPY: Record<
  ServiceKeyKind,
  {
    title: string
    description: string
  }
> = {
  copilot: {
    title: 'Copilot',
    description: 'Generate keys for Copilot API access.',
  },
  market: {
    title: 'Market',
    description: 'Generate keys for Market API access.',
  },
}

export function Service() {
  if (!isHosted) {
    return (
      <div className='px-6 py-4 text-muted-foreground text-sm'>
        Service API keys are available in hosted environments.
      </div>
    )
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
  const copy = SERVICE_COPY[service]
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
          Create
        </Button>
      </div>

      <div className='flex-1 space-y-2 px-4 py-3'>
        {isKeysPending ? (
          <>
            <ServiceKeySkeleton />
            <ServiceKeySkeleton />
          </>
        ) : keys.length === 0 ? (
          <div className='py-3 text-center text-muted-foreground text-xs'>No API keys yet</div>
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
                Delete
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
            <AlertDialogTitle>Your API key has been created</AlertDialogTitle>
            <AlertDialogDescription>
              This is the only time you will see your API key.{' '}
              <span className='font-semibold'>Copy it now and store it securely.</span>
            </AlertDialogDescription>
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
                <span className='sr-only'>Copy to clipboard</span>
              </Button>
            </div>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className='rounded-md sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this API key will immediately revoke access for any integrations using it.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' onClick={() => setDeleteKey(null)}>
              Cancel
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
              Delete
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
