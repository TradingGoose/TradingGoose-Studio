import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  provider: 'local',
  configs: {} as Record<string, Record<string, string>>,
  resolve: vi.fn(),
  backend: vi.fn(),
}))
vi.mock('@/lib/uploads/core/setup', () => ({
  getStorageProvider: () => state.provider,
  get USE_S3_STORAGE() {
    return state.provider === 's3'
  },
  USE_AZURE_STORAGE: false,
  USE_VERCEL_STORAGE: false,
}))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => state.configs[context] ?? state.configs.general,
}))
vi.mock('@/lib/uploads/core/local-path', () => ({ UPLOAD_DIR_SERVER: '/unit-public-storage' }))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  resolveAuthorizedWorkspaceFileReference: state.resolve,
}))
vi.mock('@/lib/uploads/core/storage-client', () => ({ downloadFile: state.backend }))
vi.mock('@/lib/uploads/providers/s3/s3-client', () => ({ downloadFromS3: state.backend }))

import { createLogger } from '@/lib/logs/console/logger'
import { ArchiveAccessError } from '@/lib/uploads/archive-boundary'
import {
  assertStorageDeleteAccess,
  assertStorageReadAccess,
  PrivateSourceAccessError,
} from '@/lib/uploads/source-read-boundary'
import {
  downloadFileFromStorage,
  processFilesToUserFiles,
  processSingleFileToUserFile,
} from './file-processing'

const logger = createLogger('FileAuthorityTest')
const url =
  '/api/files/serve/s3/workspace-a/file.png?context=workspace&workspaceId=workspace-a&fileId=file-a'
const row = { id: 'file-a', key: 'workspace-a/file.png', workspaceId: 'workspace-a' }
const file = () =>
  processSingleFileToUserFile(
    {
      path: url,
      name: 'declared.png',
      size: 3,
      type: 'image/png',
      context: 'workspace',
    },
    'request',
    logger
  )
const authority = (signal = new AbortController().signal) => ({
  actorUserId: 'requester',
  workspaceId: 'workspace-a',
  signal,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.provider = 'local'
  state.configs = {
    copilot: { bucket: 'shared-private', region: 'unit' },
    workspace: { bucket: 'shared-private', region: 'unit' },
    general: { bucket: 'shared-private', region: 'unit' },
    execution: { bucket: 'disjoint-execution', region: 'unit' },
  }
  state.resolve.mockResolvedValue({ ...row })
  state.backend.mockResolvedValue(Buffer.from('png'))
})
afterEach(() => vi.restoreAllMocks())

describe('canonical file normalization', () => {
  it('keeps actual URL fileId and declared metadata/context without inventing a canonical ID', () => {
    const result = file()
    expect(result).toMatchObject({
      id: 'file-a',
      key: row.key,
      url,
      context: 'workspace',
      name: 'declared.png',
      size: 3,
      type: 'image/png',
    })
    expect(
      processSingleFileToUserFile({ url, name: 'url-only.png' }, 'request', logger)
    ).toMatchObject({ id: 'file-a', key: row.key, url, context: 'workspace' })
  })
  it.each([
    { id: 'another-id' },
    { key: 'workspace-a/other.png' },
    { context: 'general' },
    { workspaceId: 'other-workspace' },
    { url: url.replace('file-a', 'other-id') },
  ])('refuses supplied canonical conflicts %j', (extra) => {
    expect(() =>
      processSingleFileToUserFile({ path: url, name: 'file', ...extra }, 'request', logger)
    ).toThrow(PrivateSourceAccessError)
  })
  it('refuses incomplete/encoded protected references before normalizing and propagates protected multi-file errors', () => {
    expect(() =>
      processSingleFileToUserFile(
        { path: '/api/files/serve/key?context=workspace' },
        'request',
        logger
      )
    ).toThrow(PrivateSourceAccessError)
    for (const path of [
      'archived-enhanced-logs/private.json',
      '/api/files/serve/%252fworkflow-archive',
    ]) {
      expect(() => processFilesToUserFiles([{ path }], 'request', logger)).toThrow(
        ArchiveAccessError
      )
    }
    expect(() => processFilesToUserFiles([{ path: url, id: 'wrong' }], 'request', logger)).toThrow(
      PrivateSourceAccessError
    )
    expect(processFilesToUserFiles([{ name: 'ordinary-no-key' }], 'request', logger)).toEqual([])
  })
})

describe('actual helper, source guard and storage service with controlled backend', () => {
  it.each(['local', 's3'])(
    'reads only the exact authorized row on %s shared storage',
    async (provider) => {
      state.provider = provider
      const auth = authority()
      state.backend.mockImplementation(async (key, _config, signal) => {
        expect(key).toBe(row.key)
        expect(signal).toBe(auth.signal)
        expect(() => assertStorageReadAccess(row.key, 'workspace')).not.toThrow()
        expect(() => assertStorageReadAccess('workspace-a/other.png', 'workspace')).toThrow(
          PrivateSourceAccessError
        )
        expect(() => assertStorageDeleteAccess(row.key, 'workspace')).toThrow('delete permission')
        return Buffer.from('png')
      })
      expect(await downloadFileFromStorage(file(), 'request', logger, auth)).toEqual(
        Buffer.from('png')
      )
      expect(state.resolve).toHaveBeenCalledTimes(3)
      expect(state.resolve).toHaveBeenCalledWith(url, 'requester')
      expect(state.backend).toHaveBeenCalledTimes(1)
      expect(() => assertStorageReadAccess(row.key, 'workspace')).toThrow(PrivateSourceAccessError)
    }
  )
  it.each([
    { id: 'foreign-id' },
    { key: 'workspace-a/foreign.png' },
    { workspaceId: 'foreign-workspace' },
    null,
  ])('refuses missing or conflicting actual rows before backend contact: %j', async (actual) => {
    state.resolve.mockResolvedValue(actual)
    await expect(downloadFileFromStorage(file(), 'request', logger, authority())).rejects.toThrow(
      PrivateSourceAccessError
    )
    expect(state.backend).not.toHaveBeenCalled()
  })
  it('rejects authoritative workspace conflict or missing trusted actor before backend contact', async () => {
    await expect(
      downloadFileFromStorage(file(), 'request', logger, { ...authority(), workspaceId: 'another' })
    ).rejects.toThrow(PrivateSourceAccessError)
    await expect(
      downloadFileFromStorage(file(), 'request', logger, { ...authority(), actorUserId: ' ' })
    ).rejects.toThrow(PrivateSourceAccessError)
    expect(state.backend).not.toHaveBeenCalled()
  })
  it('rechecks revocation/deletion immediately before IO and after IO before returning bytes', async () => {
    state.resolve.mockResolvedValueOnce(row).mockRejectedValueOnce(new PrivateSourceAccessError())
    await expect(downloadFileFromStorage(file(), 'request', logger, authority())).rejects.toThrow(
      PrivateSourceAccessError
    )
    expect(state.backend).not.toHaveBeenCalled()
    state.resolve
      .mockReset()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null)
    await expect(downloadFileFromStorage(file(), 'request', logger, authority())).rejects.toThrow(
      PrivateSourceAccessError
    )
    expect(state.backend).toHaveBeenCalledTimes(1)
  })
  it('checks cancellation around authorization and passes cancellation to actual IO', async () => {
    const controller = new AbortController()
    state.resolve.mockImplementation(async () => {
      controller.abort()
      return row
    })
    await expect(
      downloadFileFromStorage(file(), 'request', logger, authority(controller.signal))
    ).rejects.toThrow()
    expect(state.backend).not.toHaveBeenCalled()
    state.resolve.mockReset().mockResolvedValue(row)
    const during = new AbortController()
    state.backend.mockImplementation(async (_key, _config, signal) => {
      expect(signal).toBe(during.signal)
      during.abort()
      return Buffer.from('discarded')
    })
    await expect(
      downloadFileFromStorage(file(), 'request', logger, authority(during.signal))
    ).rejects.toThrow()
    expect(state.resolve).toHaveBeenCalledTimes(2)
  })
  it('does not turn raw execution/general/Copilot keys into authorization, while disjoint execution stays supported', async () => {
    for (const context of ['execution', 'general', 'copilot']) {
      const input = { ...file(), url: '', key: 'raw.png', context }
      await expect(downloadFileFromStorage(input, 'request', logger, authority())).rejects.toThrow(
        PrivateSourceAccessError
      )
    }
    expect(state.resolve).not.toHaveBeenCalled()
    expect(state.backend).not.toHaveBeenCalled()
    state.provider = 's3'
    const input = {
      ...file(),
      url: '',
      key: 'workspace/workflow/execution/file.png',
      context: 'execution',
    }
    expect(await downloadFileFromStorage(input, 'request', logger, authority())).toEqual(
      Buffer.from('png')
    )
    expect(state.backend).toHaveBeenCalledTimes(1)
    expect(state.resolve).not.toHaveBeenCalled()
  })
  it('requires a canonical locator for workspace reads even on a physically separate public S3 bucket', async () => {
    state.provider = 's3'
    state.configs.workspace = { bucket: 'public-workspace', region: 'unit' }
    const inferred = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/123-abc-file.png'
    for (const input of [
      { ...file(), url: '', key: 'raw-workspace.png', context: 'workspace' },
      { ...file(), url: '', key: inferred, context: undefined },
    ]) {
      // Destination separation is not canonical row authority.
      expect(() => assertStorageReadAccess(input.key, 'workspace')).not.toThrow()
      await expect(downloadFileFromStorage(input, 'request', logger, authority())).rejects.toThrow(
        PrivateSourceAccessError
      )
    }
    expect(state.resolve).not.toHaveBeenCalled()
    expect(state.backend).not.toHaveBeenCalled()
    state.configs.general = { bucket: 'public-general', region: 'unit' }
    const general = { ...file(), url: '', key: 'raw-general.png', context: 'general' }
    expect(await downloadFileFromStorage(general, 'request', logger, authority())).toEqual(
      Buffer.from('png')
    )
    expect(state.backend).toHaveBeenCalledTimes(1)
  })
})
