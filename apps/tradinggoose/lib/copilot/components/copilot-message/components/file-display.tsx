import { memo, useState } from 'react'
import { useLocale } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatFileSize } from '@/i18n/formatters'
import type { MessageFileAttachment, NativeImageFile } from '@/stores/copilot/types'
import { FileTypeIcon, isImageMediaType } from '../../file-type-icon'

interface FileAttachmentDisplayProps {
  fileAttachments: MessageFileAttachment[]
  workspaceId?: string | null
}

const getFileUrl = (file: MessageFileAttachment, workspaceId?: string | null) => {
  if (!file.sourceProof?.trim()) return null
  const query = new URLSearchParams({ context: 'copilot', sourceProof: file.sourceProof })
  if (workspaceId !== null && workspaceId !== undefined) query.set('workspaceId', workspaceId)
  return `/api/files/serve/${encodeURIComponent(file.key)}?${query}`
}

export const FileAttachmentDisplay = memo(
  ({ fileAttachments, workspaceId }: FileAttachmentDisplayProps) => {
    const locale = useLocale()
    const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())

    const handleFileClick = (file: MessageFileAttachment) => {
      const serveUrl = getFileUrl(file, workspaceId)
      if (serveUrl) window.open(serveUrl, '_blank', 'noopener,noreferrer')
    }

    return (
      <>
        {fileAttachments.map((file) => (
          <Tooltip key={file.id}>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-card/40'
                  disabled={!getFileUrl(file, workspaceId)}
                  onClick={() => handleFileClick(file)}
                  aria-label={file.filename}
                >
                  {isImageMediaType(file.media_type) &&
                  !failedImageIds.has(file.id) &&
                  getFileUrl(file, workspaceId) ? (
                    <img
                      src={getFileUrl(file, workspaceId) ?? undefined}
                      alt={file.filename}
                      className='h-full w-full object-cover'
                      onError={() => {
                        setFailedImageIds((current) => {
                          if (current.has(file.id)) return current
                          const next = new Set(current)
                          next.add(file.id)
                          return next
                        })
                      }}
                    />
                  ) : (
                    <span className='flex h-full w-full items-center justify-center bg-background/50'>
                      <FileTypeIcon mediaType={file.media_type} />
                    </span>
                  )}

                  <span className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
                </button>
              }
            />
            <TooltipContent side='top'>
              {!getFileUrl(file, workspaceId) || failedImageIds.has(file.id)
                ? 'Attachment preview is unavailable. Upload the file again to refresh authorization.'
                : `${file.filename} (${formatFileSize(locale, file.size)})`}
            </TooltipContent>
          </Tooltip>
        ))}
      </>
    )
  }
)

FileAttachmentDisplay.displayName = 'FileAttachmentDisplay'

/** Bytes came from freshly authorized canonical native history, not an upload capability. */
export const NativeFileDisplay = memo(({ file }: { file: NativeImageFile }) => {
  const [failed, setFailed] = useState(false)
  return failed ||
    !isImageMediaType(file.mimeType) ||
    !file.data.startsWith(`data:${file.mimeType};base64,`) ? (
    <span role='status' className='text-muted-foreground text-xs'>
      Conversation image is unavailable.
    </span>
  ) : (
    <img
      data-native-image
      src={file.data}
      alt='Conversation image'
      className='my-1 max-h-80 max-w-full rounded-md object-contain'
      onError={() => setFailed(true)}
    />
  )
})

NativeFileDisplay.displayName = 'NativeFileDisplay'
