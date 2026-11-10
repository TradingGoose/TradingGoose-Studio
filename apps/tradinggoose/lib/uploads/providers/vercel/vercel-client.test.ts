/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), del: vi.fn(), token: vi.fn() }))
vi.mock('@vercel/blob', () => ({ get: sdk.get, put: sdk.put, del: sdk.del }))
vi.mock('./download-token', () => ({ createVercelDownloadToken: sdk.token }))
beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  vi.doMock('@/lib/env', () => ({
    env: {
      STORAGE_PROVIDER: 'vercel',
      VERCEL_BLOB_READ_WRITE_TOKEN: 'synthetic-token',
      VERCEL_BLOB_ACCESS: 'private',
    },
  }))
  vi.doMock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://app.example.test' }))
})
const config = { token: 'synthetic-token', access: 'private' as const }

describe('Vercel transport with explicit internal source authorization', () => {
  it('downloads actual get() stream bytes only inside the exact authorized read capability', async () => {
    const { withAuthorizedStorageRead } = await import('@/lib/uploads/source-read-boundary')
    const { downloadFromVercel } = await import('./vercel-client')
    sdk.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response('hello from blob').body,
      headers: new Headers(),
      blob: { pathname: 'file.txt' },
    })
    // Explicit component-level authorized-capability seam; not a fabricated owner row or public caller context.
    const file = await withAuthorizedStorageRead('file.txt', 'workspace', () =>
      downloadFromVercel('file.txt', config)
    )
    expect(sdk.get).toHaveBeenCalledWith('file.txt', config)
    expect(file.toString()).toBe('hello from blob')
  })
  it('denies raw shared-store reads/signs before provider contact, even with a different token', async () => {
    const { downloadFromVercel, getDownloadUrlWithConfig } = await import('./vercel-client')
    await expect(
      downloadFromVercel('flat-old-key.txt', { ...config, token: 'different-token' })
    ).rejects.toThrow('File access is unavailable')
    await expect(
      getDownloadUrlWithConfig('flat-old-key.txt', config, 120, 'workspace')
    ).rejects.toThrow('File access is unavailable')
    expect(sdk.get).not.toHaveBeenCalled()
    expect(sdk.token).not.toHaveBeenCalled()
  })
  it('binds capability to the exact source key and clears it after the authorized action', async () => {
    const { withAuthorizedStorageRead } = await import('@/lib/uploads/source-read-boundary')
    const { downloadFromVercel } = await import('./vercel-client')
    await withAuthorizedStorageRead('owned.txt', 'workspace', async () => {
      await expect(downloadFromVercel('other.txt', config)).rejects.toThrow(
        'File access is unavailable'
      )
    })
    await expect(downloadFromVercel('owned.txt', config)).rejects.toThrow(
      'File access is unavailable'
    )
    expect(sdk.get).not.toHaveBeenCalled()
  })
  it.each([null, { statusCode: 404 }, { statusCode: 200 }])(
    'retains missing-file/stream transport failure: %j',
    async (response) => {
      const { withAuthorizedStorageRead } = await import('@/lib/uploads/source-read-boundary')
      const { downloadFromVercel } = await import('./vercel-client')
      sdk.get.mockResolvedValueOnce(response)
      await expect(
        withAuthorizedStorageRead('missing.txt', 'workspace', () =>
          downloadFromVercel('missing.txt', config)
        )
      ).rejects.toThrow('File not found in Vercel Blob')
    }
  )
  it('creates a scoped signed URL only inside an exact authorized server read', async () => {
    const { withAuthorizedStorageRead } = await import('@/lib/uploads/source-read-boundary')
    const { getDownloadUrlWithConfig } = await import('./vercel-client')
    sdk.token.mockResolvedValueOnce('scoped-download-token')
    const signed = await withAuthorizedStorageRead('nested/owned.txt', 'workspace', () =>
      getDownloadUrlWithConfig('nested/owned.txt', config, 120, 'workspace')
    )
    expect(sdk.token).toHaveBeenCalledWith({ key: 'nested/owned.txt', context: 'workspace' }, 120)
    const url = new URL(signed)
    expect(url.pathname).toBe('/api/files/serve/vercel/nested%2Fowned.txt')
    expect(url.searchParams.get('downloadToken')).toBe('scoped-download-token')
  })
  it('forwards exclusive-create only when selected and preserves normal omitted-option defaults', async () => {
    const { uploadToVercel } = await import('./vercel-client')
    sdk.put.mockResolvedValue({ pathname: 'nested/source.txt' })
    const bytes = Buffer.from('immutable source')
    await uploadToVercel(bytes, 'nested/source.txt', 'text/plain', config, bytes.length, true, true)
    expect(sdk.put).toHaveBeenLastCalledWith('nested/source.txt', bytes, {
      access: 'private',
      token: config.token,
      contentType: 'text/plain',
      addRandomSuffix: false,
      multipart: false,
      allowOverwrite: false,
    })
    await uploadToVercel(bytes, 'ordinary.txt', 'text/plain', config, bytes.length, true)
    expect(sdk.put.mock.calls.at(-1)?.[2]).not.toHaveProperty('allowOverwrite')
    sdk.put.mockRejectedValueOnce(new Error('Blob already exists'))
    await expect(
      uploadToVercel(
        Buffer.from('replacement'),
        'nested/source.txt',
        'text/plain',
        config,
        undefined,
        true,
        true
      )
    ).rejects.toThrow('Blob already exists')
    expect(sdk.put).toHaveBeenCalledTimes(3)
  })
  it('keeps configured token/pathname deletion and provider error behavior', async () => {
    const { deleteFromVercel } = await import('./vercel-client')
    sdk.del.mockResolvedValueOnce(undefined)
    const { withAuthorizedStorageDelete } = await import('@/lib/uploads/source-read-boundary')
    await withAuthorizedStorageDelete('kb/report.pdf', 'knowledge-base', () =>
      deleteFromVercel('kb/report.pdf', config)
    )
    expect(sdk.del).toHaveBeenCalledWith('kb/report.pdf', { token: config.token })
    sdk.del.mockRejectedValueOnce(new Error('Delete failed'))
    await expect(
      withAuthorizedStorageDelete('failed', 'knowledge-base', () =>
        deleteFromVercel('failed', config)
      )
    ).rejects.toThrow('Delete failed')
  })
})

it('cancels and awaits an actual Vercel body read under the exact capability', async () => {
  const { withAuthorizedStorageRead } = await import('@/lib/uploads/source-read-boundary')
  const { downloadFromVercel } = await import('./vercel-client')
  const cancelled = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
    cancel: cancelled,
  })
  sdk.get.mockResolvedValueOnce({ statusCode: 200, stream: body })
  const controller = new AbortController()
  const read = withAuthorizedStorageRead('file.txt', 'workspace', () =>
    downloadFromVercel('file.txt', config, controller.signal)
  )
  const outcome = expect(read).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(body.locked).toBe(true))
  controller.abort()
  await outcome
  expect(cancelled).toHaveBeenCalledOnce()
  expect(body.locked).toBe(false)
  expect(sdk.get).toHaveBeenCalledWith('file.txt', { ...config, abortSignal: controller.signal })
  sdk.get.mockClear()
  await expect(
    withAuthorizedStorageRead('file.txt', 'workspace', () =>
      downloadFromVercel('file.txt', config, AbortSignal.abort())
    )
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(sdk.get).not.toHaveBeenCalled()
})
