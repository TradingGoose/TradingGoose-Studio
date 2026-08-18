import { FileText, Image } from 'lucide-react'

export const isImageMediaType = (mediaType: string) => mediaType.startsWith('image/')

export function FileTypeIcon({ mediaType }: { mediaType: string }) {
  if (isImageMediaType(mediaType)) {
    return <Image className='h-5 w-5 text-muted-foreground' />
  }
  if (mediaType.includes('pdf')) {
    return <FileText className='h-5 w-5 text-red-500' />
  }
  if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
    return <FileText className='h-5 w-5 text-blue-500' />
  }
  return <FileText className='h-5 w-5 text-muted-foreground' />
}
