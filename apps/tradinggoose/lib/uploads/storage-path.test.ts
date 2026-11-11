import { afterEach, expect, it, vi } from 'vitest'
import { assertStorageReferenceAccess, fetchPublicStorageUrl } from './utils/file-utils'

afterEach(() => vi.unstubAllGlobals())
it.each(['folder/../private', 'broken%zz'])('rejects inaccessible file reference %s', (value) => {
  expect(() => assertStorageReferenceAccess(value)).toThrow()
})
it('allows ordinary storage paths and checks a redirect before a second request', async () => {
  expect(() => assertStorageReferenceAccess('ordinary.txt')).not.toThrow()
  const fetcher = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: 'file:///private.png' },
    })
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchPublicStorageUrl('https://files.example/ordinary')).rejects.toThrow()
  expect(fetcher).toHaveBeenCalledOnce()
})
