'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, FileText, Search, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
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
  Input,
  Progress,
  Skeleton,
} from '@/components/ui'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { cn } from '@/lib/utils'
import {
  ACCEPT_ATTR,
  useWorkspaceFilesManager,
} from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files'
import {
  formatDisplayDate,
  formatFileSize,
  formatStorageSize,
  GRADIENT_TEXT_STYLES,
  PLAN_NAMES,
  truncateMiddle,
} from '@/app/workspace/[workspaceId]/files/utils'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { GlobalNavbarHeader } from '@/global-navbar'

export function WorkspaceFiles() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const userPermissions = useUserPermissionsContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')

  const {
    files,
    loading,
    uploading,
    deletingFileId,
    uploadError,
    uploadProgress,
    storageInfo,
    storageLoading,
    planName,
    uploadFiles,
    downloadFile,
    deleteFile,
  } = useWorkspaceFilesManager(workspaceId)
  const [filePendingDelete, setFilePendingDelete] = useState<WorkspaceFileRecord | null>(null)

  const filteredFiles = useMemo(() => {
    if (!search) return files
    const q = search.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, search])

  const displayPlanName = PLAN_NAMES[planName as keyof typeof PLAN_NAMES] || 'Free'

  const uploadButtonLabel =
    uploading && uploadProgress.total > 0
      ? `Uploading ${uploadProgress.completed}/${uploadProgress.total}...`
      : uploading
        ? 'Uploading...'
        : 'Upload File'

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files
    if (!list || list.length === 0) return
    await uploadFiles(list)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <FileText className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Files</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search files...'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRightContent = (
    <div className='flex items-center gap-4'>
      {storageLoading ? (
        <Skeleton className='h-6 w-40' />
      ) : storageInfo ? (
        <div className='flex flex-col items-end gap-1'>
          <div className='flex items-center gap-2 text-sm'>
            <span
              className={cn(
                'font-medium',
                planName === 'free' ? 'text-foreground' : GRADIENT_TEXT_STYLES
              )}
            >
              {displayPlanName}
            </span>
            <span className='text-muted-foreground tabular-nums'>
              {formatStorageSize(storageInfo.usedBytes)} /{' '}
              {formatStorageSize(storageInfo.limitBytes)}
            </span>
          </div>
          <Progress
            value={Math.min(storageInfo.percentUsed, 100)}
            className='h-1 w-36'
            indicatorClassName='bg-black dark: '
          />
        </div>
      ) : null}
      {userPermissions.canEdit && (
        <div className='flex items-center'>
          <input
            ref={fileInputRef}
            type='file'
            className='hidden'
            accept={ACCEPT_ATTR}
            multiple
            onChange={handleFileChange}
            disabled={uploading}
          />
          <Button
            variant='default'
            className='h-9 rounded-md px-4'
            onClick={handleUploadClick}
            disabled={uploading}
          >
            {uploadButtonLabel}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} right={headerRightContent} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
            <div className='flex h-full min-h-0 flex-1 flex-col space-y-4'>
              {uploadError && (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertDescription>{uploadError}</AlertDescription>
                </Alert>
              )}

              <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
                <div className='flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'>
                  <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
                    <div className='shrink-0 overflow-x-auto border-b bg-muted/40'>
                      <table className='w-full min-w-[720px] table-fixed'>
                        <colgroup>
                          <col className='w-[55%]' />
                          <col className='w-[15%]' />
                          <col className='w-[20%]' />
                          <col className='w-[10%]' />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className='px-4 pt-2 pb-3 text-left font-medium'>
                              <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                                Name
                              </span>
                            </th>
                            <th className='px-4 pt-2 pb-3 text-left font-medium'>
                              <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                                Size
                              </span>
                            </th>
                            <th className='px-4 pt-2 pb-3 text-left font-medium'>
                              <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                                Uploaded
                              </span>
                            </th>
                            <th className='px-4 pt-2 pb-3 text-left font-medium'>
                              <span className='text-muted-foreground text-xs uppercase tracking-wide'>
                                Actions
                              </span>
                            </th>
                          </tr>
                        </thead>
                      </table>
                    </div>

                    <div
                      className='min-h-0 flex-1 overflow-auto'
                      style={{ scrollbarGutter: 'stable' }}
                    >
                      <table className='w-full min-w-[720px] table-fixed'>
                        <colgroup>
                          <col className='w-[55%]' />
                          <col className='w-[15%]' />
                          <col className='w-[20%]' />
                          <col className='w-[10%]' />
                        </colgroup>
                        <tbody>
                          {loading ? (
                            [0, 1, 2].map((row) => (
                              <tr key={row} className='border-b'>
                                <td className='px-4 py-3'>
                                  <div className='flex items-center gap-3'>
                                    <Skeleton className='h-9 w-9 rounded-full' />
                                    <div className='flex-1 space-y-2'>
                                      <Skeleton className='h-3 w-3/4' />
                                      <Skeleton className='h-3 w-1/2' />
                                    </div>
                                  </div>
                                </td>
                                <td className='px-4 py-3'>
                                  <Skeleton className='h-3 w-1/3' />
                                </td>
                                <td className='px-4 py-3'>
                                  <Skeleton className='h-3 w-1/2' />
                                </td>
                                <td className='px-4 py-3'>
                                  <div className='flex justify-end gap-2'>
                                    <Skeleton className='h-8 w-8 rounded-full' />
                                    <Skeleton className='h-8 w-8 rounded-full' />
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : files.length === 0 ? (
                            <tr>
                              <td colSpan={4} className='px-4 py-12 text-center'>
                                <p className='font-medium text-lg'>No files uploaded yet</p>
                                <p className='mt-2 text-muted-foreground'>
                                  Upload PDFs, docs, spreadsheets, or slides to power your
                                  workspace.
                                </p>
                                {userPermissions.canEdit && (
                                  <Button className='mt-6' onClick={handleUploadClick}>
                                    Upload File
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ) : filteredFiles.length === 0 ? (
                            <tr>
                              <td colSpan={4} className='px-4 py-12 text-center'>
                                <p className='font-medium text-lg'>No files match your search</p>
                                <p className='mt-2 text-muted-foreground'>
                                  Try a different keyword or clear the search input.
                                </p>
                              </td>
                            </tr>
                          ) : (
                            filteredFiles.map((file) => {
                              const Icon = getDocumentIcon(file.type || '', file.name)
                              return (
                                <tr
                                  key={file.id}
                                  className='border-b transition-colors hover:bg-card/30'
                                >
                                  <td className='px-4 py-3'>
                                    <div className='flex min-w-0 items-center gap-3'>
                                      <div className='flex h-9 w-9 items-center justify-center rounded-full border bg-background'>
                                        <Icon className='h-4 w-4 text-muted-foreground' />
                                      </div>
                                      <div className='min-w-0'>
                                        <p className='truncate font-medium text-sm'>{file.name}</p>
                                        <p className='text-muted-foreground text-xs'>
                                          {truncateMiddle(file.name)}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className='px-4 py-3 text-muted-foreground text-sm'>
                                    {formatFileSize(file.size)}
                                  </td>
                                  <td className='px-4 py-3 text-muted-foreground text-sm'>
                                    {formatDisplayDate(file.uploadedAt)}
                                  </td>
                                  <td className='px-4 py-3'>
                                    <div className='flex items-center justify-centergap-1.5'>
                                      <Button
                                        variant='ghost'
                                        size='icon'
                                        onClick={() => downloadFile(file)}
                                        className='h-8 w-8'
                                        title='Download'
                                        aria-label={`Download ${file.name}`}
                                      >
                                        <Download className='h-4 w-4 text-muted-foreground' />
                                      </Button>
                                      {userPermissions.canEdit && (
                                        <Button
                                          variant='ghost'
                                          size='icon'
                                          onClick={() => setFilePendingDelete(file)}
                                          className='h-8 w-8 text-destructive hover:text-destructive'
                                          title='Delete'
                                          aria-label={`Delete ${file.name}`}
                                        >
                                          <Trash2 className='h-4 w-4' />
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AlertDialog
        open={Boolean(filePendingDelete)}
        onOpenChange={(open) => {
          if (!open) {
            const isDeletingCurrent = filePendingDelete && deletingFileId === filePendingDelete.id
            if (!isDeletingCurrent) {
              setFilePendingDelete(null)
            }
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              {filePendingDelete
                ? `Deleting "${filePendingDelete.name}" will permanently remove it from this workspace.`
                : 'Deleting this file will permanently remove it from this workspace.'}{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-sm'
              disabled={Boolean(filePendingDelete) && deletingFileId === filePendingDelete?.id}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={async () => {
                if (!filePendingDelete) return
                await deleteFile(filePendingDelete)
                setFilePendingDelete(null)
              }}
              disabled={Boolean(filePendingDelete) && deletingFileId === filePendingDelete?.id}
              className='h-9 w-full rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              {filePendingDelete && deletingFileId === filePendingDelete.id
                ? 'Deleting...'
                : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
