import { expect, it, vi } from 'vitest'
import { validateNativeImageParts } from './images'

vi.mock('@/lib/uploads/utils/validation', () => ({ MAX_FILE_SIZE: 16 }))
const image = {
  type: 'image' as const,
  mediaType: 'image/png',
  image: 'data:image/png;base64,aW1hZ2U=',
}
it('preserves ordered inline image parts beside the prompt', () => {
  const content = [{ type: 'text' as const, text: 'Describe both' }, image, { ...image }]
  validateNativeImageParts(content)
  expect(content[1]).toBe(image)
  expect(content).toHaveLength(3)
})
it.each([
  'https://files.example/image.png',
  'data:text/plain;base64,aW1hZ2U=',
  'data:image/png;base64,',
  'data:image/png;base64,%%%',
  `data:image/png;base64,${Buffer.alloc(17).toString('base64')}`,
])('rejects unsupported or oversized image input %s', (data) => {
  expect(() => validateNativeImageParts([{ ...image, image: data }])).toThrow()
})
