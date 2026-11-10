import type { ImagePart } from '@/lib/copilot/native/contract'
import {
  type CopilotAttachmentScope,
  type CopilotFileAttachment,
  processCopilotAttachments,
} from '@/lib/uploads/contexts/copilot/copilot-file-manager'

/** Only verified source bytes cross the native boundary; source locators and proofs stay here. */
export async function prepareNativeImageParts(
  attachments: CopilotFileAttachment[],
  scope: CopilotAttachmentScope,
  requestId: string,
  signal?: AbortSignal
): Promise<ImagePart[]> {
  const files = await processCopilotAttachments(attachments, scope, requestId, signal)
  signal?.throwIfAborted()
  return files.map(
    ({ buffer, attachment }): ImagePart => ({
      type: 'image',
      image: `data:${attachment.media_type};base64,${buffer.toString('base64')}`,
      mediaType: attachment.media_type,
    })
  )
}
