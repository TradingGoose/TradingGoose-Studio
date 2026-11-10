/** @vitest-environment node */
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  delete: vi.fn(),
  block: vi.fn(),
  container: vi.fn(),
  fromConnection: vi.fn(),
  sas: vi.fn(),
}))
// Keep the installed SDK's actual connection-string/account/container identity. Only byte IO/signing is synthetic.
vi.mock('@azure/storage-blob', async (original) => {
  const actual = await original<typeof import('@azure/storage-blob')>()
  class TransportFixtureServiceClient extends actual.BlobServiceClient {
    static fromConnectionString(
      ...args: Parameters<typeof actual.BlobServiceClient.fromConnectionString>
    ) {
      sdk.fromConnection(...args)
      const client = actual.BlobServiceClient.fromConnectionString(...args)
      Object.setPrototypeOf(client, TransportFixtureServiceClient.prototype)
      return client
    }
    getContainerClient(containerName: string) {
      sdk.container(containerName)
      const container = super.getContainerClient(containerName)
      const getBlob = container.getBlockBlobClient.bind(container)
      container.getBlockBlobClient = (key) => {
        sdk.block(key)
        const blob = getBlob(key)
        blob.upload = sdk.upload
        blob.download = sdk.download
        blob.delete = sdk.delete
        return blob
      }
      return container
    }
  }
  return {
    ...actual,
    BlobServiceClient: TransportFixtureServiceClient,
    generateBlobSASQueryParameters: sdk.sas,
  }
})
let copilotContainer = 'private-copilot'
const connectionString =
  'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdC1vbmx5LWtleQ==;EndpointSuffix=core.windows.net'
const stream = (text: string) => {
  const readable = {
    on: vi.fn((event: string, callback: (value?: Buffer) => void) => {
      if (event === 'data') callback(Buffer.from(text))
      else if (event === 'end') callback()
      return readable
    }),
  }
  return readable
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  copilotContainer = 'private-copilot'
  sdk.sas.mockReturnValue({ toString: () => 'sv=2021-06-08&sp=r&sig=synthetic-signature' })
  vi.doMock('@/lib/env', () => ({
    env: {
      STORAGE_PROVIDER: 'azure',
      AZURE_ACCOUNT_NAME: 'testaccount',
      AZURE_ACCOUNT_KEY: 'dGVzdC1vbmx5LWtleQ==',
      AZURE_CONNECTION_STRING: connectionString,
      AZURE_STORAGE_CONTAINER_NAME: 'testcontainer',
      AZURE_STORAGE_COPILOT_CONTAINER_NAME: copilotContainer,
    },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('Azure provider transport with actual physical destination resolution', () => {
  it('uploads bytes/metadata with unchanged defaults and returns the real selected container key', async () => {
    const { uploadToAzure } = await import('./azure-client')
    const bytes = Buffer.from('test file content')
    sdk.upload.mockResolvedValueOnce({})
    const result = await uploadToAzure(bytes, 'test-file.txt', 'text/plain')
    expect(sdk.upload).toHaveBeenCalledWith(bytes, bytes.length, {
      blobHTTPHeaders: { blobContentType: 'text/plain' },
      metadata: { originalName: 'test-file.txt', uploadedAt: expect.any(String) },
    })
    expect(result).toEqual({
      path: expect.stringContaining('/api/files/serve/azure/'),
      key: expect.stringContaining('test-file.txt'),
      name: 'test-file.txt',
      size: bytes.length,
      type: 'text/plain',
    })
    expect(sdk.container).toHaveBeenCalledWith('testcontainer')
  })
  it('uses an explicitly selected container for upload', async () => {
    const { uploadToAzure } = await import('./azure-client')
    sdk.upload.mockResolvedValueOnce({})
    const result = await uploadToAzure(Buffer.from('content'), 'test-file.txt', 'text/plain', {
      containerName: 'customcontainer',
      accountName: 'testaccount',
      connectionString,
    })
    expect(sdk.container).toHaveBeenCalledWith('customcontainer')
    expect(result.name).toBe('test-file.txt')
  })
  it('sets the SDK exclusive-create condition and exact key, then propagates collision failure without a fallback overwrite', async () => {
    const { uploadToAzure } = await import('./azure-client')
    const config = { containerName: 'testcontainer', accountName: 'testaccount', connectionString }
    const bytes = Buffer.from('immutable source')
    sdk.upload.mockResolvedValueOnce({})
    const result = await uploadToAzure(
      bytes,
      'nested/owned.txt',
      'text/plain',
      config,
      bytes.length,
      true,
      true
    )
    expect(result.key).toBe('nested/owned.txt')
    expect(sdk.block).toHaveBeenLastCalledWith('nested/owned.txt')
    expect(sdk.upload).toHaveBeenLastCalledWith(bytes, bytes.length, {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: 'text/plain' },
      metadata: { originalName: 'nested%2Fowned.txt', uploadedAt: expect.any(String) },
    })
    sdk.upload.mockRejectedValueOnce(new Error('ConditionNotMet: existing key'))
    await expect(
      uploadToAzure(
        Buffer.from('replacement'),
        'nested/owned.txt',
        'text/plain',
        config,
        undefined,
        true,
        true
      )
    ).rejects.toThrow('ConditionNotMet')
    expect(sdk.upload).toHaveBeenCalledTimes(2)
  })
  it('downloads general bytes through a proved distinct container and preserves stream content', async () => {
    const { downloadFromAzure } = await import('./azure-client')
    sdk.download.mockResolvedValueOnce({ readableStreamBody: stream('downloaded content') })
    expect(await downloadFromAzure('test-file-key')).toEqual(Buffer.from('downloaded content'))
    expect(sdk.block).toHaveBeenCalledWith('test-file-key')
    expect(sdk.download).toHaveBeenCalledOnce()
  })
  it('uses the actual custom connection endpoint for download instead of a misleading account label', async () => {
    const { downloadFromAzure } = await import('./azure-client')
    const customConnection =
      'BlobEndpoint=https://another-account.blob.core.windows.net/;SharedAccessSignature=sv=fixture'
    sdk.download.mockImplementationOnce(function (this: { url: string }) {
      expect(new URL(this.url).origin + new URL(this.url).pathname).toBe(
        'https://another-account.blob.core.windows.net/private-copilot/owned.txt'
      )
      expect(new URL(this.url).searchParams.get('sv')).toBe('fixture')
      return Promise.resolve({ readableStreamBody: stream('custom endpoint bytes') })
    })
    expect(
      await downloadFromAzure('owned.txt', {
        connectionString: customConnection,
        accountName: 'misleading-label',
        containerName: 'private-copilot',
      })
    ).toEqual(Buffer.from('custom endpoint bytes'))
    expect(sdk.fromConnection).toHaveBeenCalledWith(customConnection)
  })
  it('rejects absent download streams and propagates download errors', async () => {
    const { downloadFromAzure } = await import('./azure-client')
    sdk.download.mockResolvedValueOnce({})
    await expect(downloadFromAzure('missing')).rejects.toThrow('Failed to get readable stream')
    sdk.download.mockRejectedValueOnce(new Error('Provider download failed'))
    await expect(downloadFromAzure('failed')).rejects.toThrow('Provider download failed')
  })
  it('deletes the selected blob and propagates deletion errors', async () => {
    const { deleteFromAzure } = await import('./azure-client')
    sdk.delete.mockResolvedValueOnce({})
    await deleteFromAzure('test-file-key')
    expect(sdk.block).toHaveBeenCalledWith('test-file-key')
    expect(sdk.delete).toHaveBeenCalledOnce()
    sdk.delete.mockRejectedValueOnce(new Error('Provider delete failed'))
    await expect(deleteFromAzure('failed')).rejects.toThrow('Provider delete failed')
  })
  it('signs only the actual disjoint general container and preserves expiry/permissions', async () => {
    const { getPresignedUrl } = await import('./azure-client')
    const before = Date.now()
    const result = await getPresignedUrl('test-file-key', 120)
    const after = Date.now()
    expect(result).toBe(
      'https://testaccount.blob.core.windows.net/testcontainer/test-file-key?sv=2021-06-08&sp=r&sig=synthetic-signature'
    )
    expect(sdk.sas).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: 'testcontainer',
        blobName: 'test-file-key',
        permissions: expect.objectContaining({ read: true }),
      }),
      expect.any(Object)
    )
    const options = sdk.sas.mock.calls[0][0]
    expect(options.expiresOn.getTime()).toBeGreaterThanOrEqual(before + 120000)
    expect(options.expiresOn.getTime()).toBeLessThanOrEqual(after + 120000)
  })
  it('uses an actual custom account/key client for signing', async () => {
    const { getPresignedUrlWithConfig } = await import('./azure-client')
    const result = await getPresignedUrlWithConfig('owned.txt', {
      accountName: 'differentaccount',
      accountKey: 'dGVzdC1vbmx5LWtleQ==',
      containerName: 'private-copilot',
    })
    expect(result).toContain(
      'https://differentaccount.blob.core.windows.net/private-copilot/owned.txt?'
    )
    expect(sdk.sas).toHaveBeenCalledOnce()
  })
  it('denies raw read/sign before byte or signing contact when selected Copilot and general containers coincide', async () => {
    copilotContainer = 'testcontainer'
    const { downloadFromAzure, getPresignedUrl } = await import('./azure-client')
    await expect(downloadFromAzure('old-flat-key')).rejects.toThrow('File access is unavailable')
    await expect(getPresignedUrl('old-flat-key')).rejects.toThrow('File access is unavailable')
    expect(sdk.download).not.toHaveBeenCalled()
    expect(sdk.sas).not.toHaveBeenCalled()
    expect(sdk.block).not.toHaveBeenCalled()
  })
  it.each([
    { input: 'test file.txt', expected: 'test file.txt' },
    { input: 'test"file.txt', expected: 'testfile.txt' },
    { input: 'test\\file.txt', expected: 'testfile.txt' },
    { input: 'test  file.txt', expected: 'test file.txt' },
    { input: '', expected: 'file' },
  ])('sanitizes metadata $input', async ({ input, expected }) => {
    const { sanitizeFilenameForMetadata } = await import('./azure-client')
    expect(sanitizeFilenameForMetadata(input)).toBe(expected)
  })
})

it('cancels an actual Azure body and observes its rejection instead of parsing partial data', async () => {
  const { downloadFromAzure } = await import('./azure-client')
  const body = new PassThrough()
  const controller = new AbortController()
  sdk.download.mockResolvedValueOnce({ readableStreamBody: body })
  const read = downloadFromAzure('test-file.txt', undefined, controller.signal)
  const outcome = expect(read).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(body.listenerCount('data')).toBeGreaterThan(0))
  body.write('partial')
  controller.abort()
  await outcome
  expect(body.destroyed).toBe(true)
  expect(sdk.download).toHaveBeenCalledWith(0, undefined, { abortSignal: controller.signal })
  sdk.download.mockClear()
  await expect(
    downloadFromAzure('test-file.txt', undefined, AbortSignal.abort())
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(sdk.download).not.toHaveBeenCalled()
})
