import { memo, useState } from 'react'
import type { NativeImageFile } from '@/stores/copilot/types'
import { isImageMediaType } from '../../file-type-icon'

/** Image bytes are retained in authorized native conversation history. */
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
