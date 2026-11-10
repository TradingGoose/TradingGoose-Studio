import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  provider: 's3',
  configs: {} as Record<string, Record<string, string>>,
}))
vi.mock('@/lib/uploads/core/setup', () => ({ getStorageProvider: () => state.provider }))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => state.configs[context] ?? state.configs.general ?? {},
}))

import { fetchPublicStorageUrl } from './archive-boundary'
import {
  assertStorageDeleteAccess,
  assertStorageDeleteReferenceAccess,
  assertStorageReadAccess,
  assertStorageReferenceAccess,
  withAuthorizedStorageDelete,
  withAuthorizedStorageRead,
} from './source-read-boundary'

beforeEach(() => {
  state.provider = 's3'
  state.configs = {
    copilot: { bucket: 'private-images', region: 'region-a' },
    general: { bucket: 'private-images', region: 'region-b' },
    workspace: { bucket: 'private-images', region: 'region-c' },
    execution: { bucket: 'public-execution', region: 'region-a' },
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('effective private source boundary', () => {
  it('refuses raw protected deletion and does not promote a source READ scope to DELETE', async () => {
    expect(() => assertStorageDeleteAccess('old-flat.png', 'general')).toThrow('delete permission')
    await withAuthorizedStorageRead('owned.png', 'copilot', async () => {
      expect(() => assertStorageReadAccess('owned.png', 'copilot')).not.toThrow()
      expect(() => assertStorageDeleteAccess('owned.png', 'copilot')).toThrow('delete permission')
      expect(() =>
        assertStorageDeleteReferenceAccess(
          '/api/files/serve/owned.png?context=copilot',
          'execution'
        )
      ).toThrow('delete permission')
    })
  })
  it('binds genuine delete purpose to exact key/destination and clears it afterward', async () => {
    await withAuthorizedStorageDelete('owned.png', 'workspace', async () => {
      await Promise.resolve()
      expect(() => assertStorageDeleteAccess('owned.png', 'workspace')).not.toThrow()
      expect(() => assertStorageDeleteAccess('other.png', 'workspace')).toThrow()
      expect(() => assertStorageReadAccess('owned.png', 'workspace')).toThrow()
      expect(() => assertStorageDeleteAccess('archived-enhanced-logs/owned', 'workspace')).toThrow()
    })
    expect(() => assertStorageDeleteAccess('owned.png', 'workspace')).toThrow()
  })
  it.each(['local', 'vercel', 'azure'] as const)(
    'refuses unknown/shared destructive destination %s',
    (provider) => {
      state.provider = provider
      expect(() => assertStorageDeleteAccess('old-flat.png', 'general')).toThrow(
        'delete permission'
      )
    }
  )

  it('never treats a provider object key spelled as an external URL as authority', () => {
    expect(() => assertStorageReadAccess('https://public.example/object', 'general')).toThrow(
      'File access'
    )
  })
  it.each(['general', 'workspace', 'chat', 'knowledge-base', 'profile-pictures'] as const)(
    'rejects same S3 bucket across regions/contexts: %s',
    (context) =>
      expect(() => assertStorageReadAccess('old-flat.png', context)).toThrow('File access')
  )
  it('allows proved disjoint general storage and refuses unknown destination', () => {
    state.configs.general = { bucket: 'general-public', region: 'other' }
    expect(() => assertStorageReadAccess('public.pdf', 'general')).not.toThrow()
    expect(() => assertStorageReadAccess('old.png', 'general', {})).toThrow('File access')
  })
  it.each([
    'https://private-images.s3.us-west-2.amazonaws.com/old-flat.png',
    'https://s3.amazonaws.com/private-images/old-flat.png',
    's3://private-images/old-flat.png',
    'https://studio.example/api/files/serve/s3/old-flat.png?context=general',
    '/api/files/serve/old-flat.png?context=chat',
    '/api/files/serve/%6fld-flat.png?context=general',
  ])('rejects raw cloud/serve aliases before fetch: %s', (url) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(() => assertStorageReferenceAccess(url)).toThrow('File access')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses unknown own-cloud destinations without closing external public URLs', () => {
    state.configs.copilot = {}
    expect(() =>
      assertStorageReferenceAccess('https://s3.amazonaws.com/unknown/file.png')
    ).toThrow()
    expect(() => assertStorageReferenceAccess('https://public.example/file.png')).not.toThrow()
  })
  it('binds internal authorization to exact key and physical destination, then clears it', async () => {
    await withAuthorizedStorageRead('owned.png', 'copilot', async () => {
      await Promise.resolve()
      expect(() => assertStorageReadAccess('owned.png', 'general')).not.toThrow()
      expect(() => assertStorageReadAccess('another.png', 'general')).toThrow('File access')
      expect(() =>
        assertStorageReadAccess('owned.png', 'general', { bucket: 'unknown-other' })
      ).not.toThrow()
      state.configs.copilot = { bucket: 'changed-private' }
      expect(() => assertStorageReadAccess('owned.png', 'copilot')).toThrow('File access')
    })
    expect(() => assertStorageReadAccess('owned.png', 'copilot')).toThrow('File access')
  })
  it('isolates concurrently authorized reads and never bypasses archive restrictions', async () => {
    await Promise.all(
      ['first.png', 'second.png'].map((key) =>
        withAuthorizedStorageRead(key, 'copilot', async () => {
          await Promise.resolve()
          expect(() => assertStorageReadAccess(key, 'copilot')).not.toThrow()
          expect(() =>
            assertStorageReadAccess(key === 'first.png' ? 'second.png' : 'first.png', 'copilot')
          ).toThrow()
          expect(() =>
            assertStorageReadAccess('archived-enhanced-logs/private', 'copilot')
          ).toThrow()
        })
      )
    )
  })
  it('uses Azure SDK effective connection endpoint and container rather than supplied account label', () => {
    state.provider = 'azure'
    const connectionString =
      'BlobEndpoint=https://real-account.blob.core.windows.net/;SharedAccessSignature=sv=fixture'
    state.configs = {
      copilot: { connectionString, accountName: 'label-a', containerName: 'shared' },
      general: { connectionString, accountName: 'label-b', containerName: 'shared' },
      execution: { connectionString, accountName: 'label-c', containerName: 'disjoint' },
    }
    expect(() => assertStorageReadAccess('old-flat.png', 'general')).toThrow('File access')
    expect(() =>
      assertStorageReferenceAccess('https://real-account.blob.core.windows.net/shared/old-flat.png')
    ).toThrow('File access')
    expect(() => assertStorageReadAccess('own.pdf', 'execution')).not.toThrow()
    expect(() =>
      assertStorageReferenceAccess('https://real-account.blob.core.windows.net/disjoint/own.pdf')
    ).not.toThrow()
  })
  it('protects emulator account paths and rejects malformed Azure identity', () => {
    state.provider = 'azure'
    state.configs = {
      copilot: { connectionString: 'UseDevelopmentStorage=true', containerName: 'shared' },
    }
    expect(() =>
      assertStorageReferenceAccess('http://127.0.0.1:10000/devstoreaccount1/shared/private.png')
    ).toThrow()
    state.configs.copilot.connectionString = 'malformed'
    expect(() => assertStorageReadAccess('private.png')).toThrow()
  })
  it('treats different Vercel tokens as shared, including raw cloud URLs', () => {
    state.provider = 'vercel'
    state.configs = { copilot: { token: 'one' }, general: { token: 'two' } }
    expect(() => assertStorageReadAccess('old-flat.png', 'general')).toThrow()
    expect(() =>
      assertStorageReferenceAccess('https://store.public.blob.vercel-storage.com/old-flat.png')
    ).toThrow()
  })
  it.each([
    'old-flat.png',
    '/uploads/old-flat.png',
    '/api/files/serve/old-flat.png',
    'file:///tmp/uploads/old-flat.png',
  ])('refuses unproved local aliases %s', (key) => {
    state.provider = 'local'
    expect(() => assertStorageReadAccess(key)).toThrow()
  })
  it('checks every redirect and makes no protected target contact', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://private-images.s3.amazonaws.com/private.png' },
      })
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchPublicStorageUrl('https://public.example/redirect')).rejects.toThrow(
      'File access'
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('https://public.example/redirect')
  })
  it('retains external public policy with guarded redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('public', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await (await fetchPublicStorageUrl('https://public.example/image.png')).text()).toBe(
      'public'
    )
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
