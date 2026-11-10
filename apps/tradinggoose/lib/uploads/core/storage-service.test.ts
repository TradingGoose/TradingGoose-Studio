/** @vitest-environment node */
import { mkdtemp, readFile, writeFile as realWriteFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transports = vi.hoisted(() => ({
  s3: vi.fn(),
  azure: vi.fn(),
  vercel: vi.fn(),
  writeFile: vi.fn(),
}))
let selectedProvider = 'vercel'
let temporaryRoot: string | undefined
const applicationCwd = process.cwd()
beforeEach(() => {
  vi.resetAllMocks()
  transports.writeFile.mockImplementation((file, data, options) => {
    if (
      typeof file !== 'string' ||
      !temporaryRoot ||
      !resolve(file).startsWith(resolve(temporaryRoot) + sep)
    )
      throw new Error('Test refused a write outside its disposable root')
    return realWriteFile(file, data, options)
  })
  vi.resetModules()
  selectedProvider = 'vercel'
  temporaryRoot = undefined
  vi.doMock('@/lib/env', () => ({
    env: {
      STORAGE_PROVIDER: selectedProvider,
      S3_BUCKET_NAME: 'general-bucket',
      S3_COPILOT_BUCKET_NAME: 'private-copilot-bucket',
      AWS_REGION: 'fixture-region',
      AZURE_ACCOUNT_NAME: 'testaccount',
      AZURE_ACCOUNT_KEY: 'dGVzdC1vbmx5LWtleQ==',
      AZURE_STORAGE_CONTAINER_NAME: 'general-container',
      AZURE_STORAGE_COPILOT_CONTAINER_NAME: 'private-copilot',
      VERCEL_BLOB_READ_WRITE_TOKEN: 'synthetic-token',
      VERCEL_BLOB_ACCESS: 'private',
    },
  }))
  vi.doMock('@/lib/uploads/providers/s3/s3-client', () => ({ uploadToS3: transports.s3 }))
  vi.doMock('@/lib/uploads/providers/azure/azure-client', () => ({
    uploadToAzure: transports.azure,
  }))
  vi.doMock('@/lib/uploads/providers/vercel/vercel-client', () => ({
    uploadToVercel: transports.vercel,
  }))
  vi.doMock('fs/promises', async (original) => {
    const actual = await original<typeof import('node:fs/promises')>()
    return { ...actual, writeFile: transports.writeFile }
  })
  vi.doMock('@/lib/uploads/core/setup.server', () => ({
    get UPLOAD_DIR_SERVER() {
      if (!temporaryRoot) throw new Error('Disposable root is not initialized')
      return temporaryRoot
    },
  }))
})
afterEach(async () => {
  process.chdir(applicationCwd)
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const info = {
  path: '/api/files/serve/vercel/workspace%2Freport.txt',
  key: 'workspace/report.txt',
  name: 'workspace/report.txt',
  size: 4,
  type: 'text/plain',
}

describe('storage service provider forwarding and actual local exclusive writes', () => {
  it('returns the context-aware Vercel serve path with unchanged ordinary upload defaults', async () => {
    transports.vercel.mockResolvedValue(info)
    const { uploadFile } = await import('./storage-service')
    const bytes = Buffer.from('test')
    const result = await uploadFile({
      file: bytes,
      fileName: 'report.txt',
      contentType: 'text/plain',
      context: 'workspace',
      preserveKey: true,
      customKey: 'workspace/report.txt',
    })
    expect(transports.vercel).toHaveBeenCalledWith(
      bytes,
      'workspace/report.txt',
      'text/plain',
      { token: 'synthetic-token', access: 'private' },
      bytes.length,
      true,
      undefined
    )
    expect(result.path).toBe('/api/files/serve/vercel/workspace%2Freport.txt?context=workspace')
  })
  it.each(['s3', 'azure', 'vercel'] as const)(
    'forwards explicit exclusive-create to the actual selected %s adapter and preserves exact custom key',
    async (provider) => {
      selectedProvider = provider
      transports[provider].mockResolvedValue(info)
      const { uploadFile } = await import('./storage-service')
      const bytes = Buffer.from('immutable bytes')
      await uploadFile({
        file: bytes,
        fileName: 'original.txt',
        customKey: 'owned/immutable.txt',
        context: 'copilot',
        contentType: 'text/plain',
        preserveKey: true,
        preventOverwrite: true,
      })
      const config =
        provider === 's3'
          ? { bucket: 'private-copilot-bucket', region: 'fixture-region' }
          : provider === 'azure'
            ? {
                containerName: 'private-copilot',
                accountName: 'testaccount',
                accountKey: 'dGVzdC1vbmx5LWtleQ==',
                connectionString: '',
              }
            : { token: 'synthetic-token', access: 'private' }
      expect(transports[provider]).toHaveBeenCalledExactlyOnceWith(
        bytes,
        'owned/immutable.txt',
        'text/plain',
        config,
        bytes.length,
        true,
        true
      )
      for (const other of ['s3', 'azure', 'vercel'] as const)
        if (other !== provider) expect(transports[other]).not.toHaveBeenCalled()
    }
  )
  it.each(['s3', 'azure', 'vercel'] as const)(
    'propagates %s exclusive-create collision without a fallback provider/write',
    async (provider) => {
      selectedProvider = provider
      const failure = new Error('Existing object: conditional create rejected')
      transports[provider].mockRejectedValueOnce(failure)
      const { uploadFile } = await import('./storage-service')
      await expect(
        uploadFile({
          file: Buffer.from('replacement'),
          fileName: 'owned.txt',
          contentType: 'text/plain',
          context: 'copilot',
          preserveKey: true,
          preventOverwrite: true,
        })
      ).rejects.toBe(failure)
      expect(transports[provider]).toHaveBeenCalledOnce()
      expect(transports.writeFile).not.toHaveBeenCalled()
    }
  )
  it('forwards the explicit local wx option and leaves ordinary write options unchanged', async () => {
    selectedProvider = 'local'
    temporaryRoot = await mkdtemp(join(tmpdir(), 'tradinggoose-storage-options-'))
    expect((await import('./setup.server')).UPLOAD_DIR_SERVER).toBe(temporaryRoot)
    transports.writeFile.mockResolvedValue(undefined)
    const { uploadFile } = await import('./storage-service')
    const bytes = Buffer.from('source bytes')
    const options = {
      file: bytes,
      fileName: 'source.txt',
      customKey: 'owned/source.txt',
      contentType: 'text/plain',
      context: 'copilot' as const,
      preserveKey: true,
    }
    await uploadFile({ ...options, preventOverwrite: true })
    expect(transports.writeFile).toHaveBeenLastCalledWith(
      join(temporaryRoot, 'owned/source.txt'),
      bytes,
      { flag: 'wx' }
    )
    await uploadFile(options)
    expect(transports.writeFile).toHaveBeenLastCalledWith(
      join(temporaryRoot, 'owned/source.txt'),
      bytes,
      undefined
    )
  })
  it('uses real local writeFile wx: concurrent creation has one winner and a collision never changes its bytes', async () => {
    selectedProvider = 'local'
    vi.doUnmock('fs/promises')
    vi.doUnmock('@/lib/uploads/core/setup.server')
    temporaryRoot = await mkdtemp(join(tmpdir(), 'tradinggoose-storage-exclusive-'))
    process.chdir(temporaryRoot)
    vi.resetModules()
    const localUploadRoot = join(temporaryRoot, 'uploads')
    expect((await import('./setup.server')).UPLOAD_DIR_SERVER).toBe(localUploadRoot)
    await import('path')
    await import('uuid')
    const { uploadFile } = await import('./storage-service')
    const options = {
      fileName: 'original.txt',
      customKey: 'owned/immutable.txt',
      contentType: 'text/plain',
      context: 'copilot' as const,
      preserveKey: true,
      preventOverwrite: true,
    }
    const payloads = [Buffer.from('first source bytes'), Buffer.from('second source bytes')]
    const settled = await Promise.allSettled(
      payloads.map((file) => uploadFile({ ...options, file }))
    )
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1)
    const refusal = settled.find((item) => item.status === 'rejected')
    expect(refusal?.status === 'rejected' ? String(refusal.reason) : '').toContain('EEXIST')
    const winner = settled.findIndex((item) => item.status === 'fulfilled')
    const output = join(localUploadRoot, 'owned/immutable.txt')
    expect(await readFile(output)).toEqual(payloads[winner])
    await expect(
      uploadFile({ ...options, file: Buffer.from('forbidden replacement') })
    ).rejects.toThrow('EEXIST')
    expect(await readFile(output)).toEqual(payloads[winner])
  })
  it('preserves ordinary local overwrite behavior when exclusive-create is not selected', async () => {
    selectedProvider = 'local'
    vi.doUnmock('fs/promises')
    vi.doUnmock('@/lib/uploads/core/setup.server')
    temporaryRoot = await mkdtemp(join(tmpdir(), 'tradinggoose-storage-ordinary-'))
    process.chdir(temporaryRoot)
    vi.resetModules()
    const localUploadRoot = join(temporaryRoot, 'uploads')
    expect((await import('./setup.server')).UPLOAD_DIR_SERVER).toBe(localUploadRoot)
    const { uploadFile } = await import('./storage-service')
    const options = {
      fileName: 'ordinary.txt',
      customKey: 'workspace/ordinary.txt',
      contentType: 'text/plain',
      context: 'workspace' as const,
      preserveKey: true,
    }
    await uploadFile({ ...options, file: Buffer.from('first') })
    await uploadFile({ ...options, file: Buffer.from('replacement') })
    expect(await readFile(join(localUploadRoot, 'workspace/ordinary.txt'))).toEqual(
      Buffer.from('replacement')
    )
  })
})
