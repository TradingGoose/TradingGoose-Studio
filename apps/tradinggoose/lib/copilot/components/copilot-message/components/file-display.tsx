import { memo, useState } from 'react'
import { useLocale } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatFileSize } from '@/i18n/formatters'
import type { MessageFileAttachment } from '@/stores/copilot/types'
import { FileTypeIcon, isImageMediaType } from '../../file-type-icon'

interface FileAttachmentDisplayProps {
  fileAttachments: MessageFileAttachment[]
}

const getFileUrl = (file: MessageFileAttachment) =>
  `/api/files/serve/${encodeURIComponent(file.key)}?context=copilot`

export const FileAttachmentDisplay = memo(({ fileAttachments }: FileAttachmentDisplayProps) => {
  const locale = useLocale()
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set())

  const handleFileClick = (file: MessageFileAttachment) => {
    const serveUrl = getFileUrl(file)
    window.open(serveUrl, '_blank')
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
                onClick={() => handleFileClick(file)}
                aria-label={file.filename}
              >
                {isImageMediaType(file.media_type) && !failedImageIds.has(file.id) ? (
                  <img
                    src={getFileUrl(file)}
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
          <TooltipContent side='top'>{`${file.filename} (${formatFileSize(locale, file.size)})`}</TooltipContent>
        </Tooltip>
      ))}
    </>
  )
})

FileAttachmentDisplay.displayName = 'FileAttachmentDisplay'
