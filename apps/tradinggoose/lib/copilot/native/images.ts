import type { Input } from './contract'
import { NativeTargetError } from './errors'

/** The browser sends its selected bytes; Mastra stores the conversation's inline image parts. */
export function validateNativeImageParts(content: Input['content']): void {
  if (typeof content === 'string') return
  for (const part of content) {
    if (part.type !== 'image') continue
    const prefix = `data:${part.mediaType};base64,`
    if (!part.mediaType.startsWith('image/') || !part.image.startsWith(prefix))
      throw new NativeTargetError('Images must use inline image data', 422)
    const encoded = part.image.slice(prefix.length)
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new NativeTargetError('Image data is invalid', 422)
    const bytes = Buffer.from(encoded, 'base64')
    if (!bytes.length || bytes.toString('base64') !== encoded)
      throw new NativeTargetError('Image data is invalid', 422)
  }
}
