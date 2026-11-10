/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import {
  assertStorageDeleteAccess,
  assertStorageReadAccess,
  withAuthorizedStorageRead,
} from '@/lib/uploads/source-read-boundary'
import {
  assertKnowledgeDocumentSource,
  buildKnowledgeStorageKey,
  copyKnowledgeDocumentFile,
  deleteKnowledgeDocumentFiles,
  type KnowledgeDocumentSourceContext,
  readKnowledgeDocumentSource,
  withKnowledgeStorageContext,
} from './storage'

const state = vi.hoisted(() => ({
  provider: 's3',
  physicalRoot: 'fixture-original-root',
  configs: {} as Record<string, Record<string, string>>,
  files: new Map<string, Buffer>(),
  providerReads: vi.fn(),
  providerDeletes: vi.fn(),
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://app.fixture' }))
vi.mock('@/lib/uploads/core/setup', () => ({ getStorageProvider: () => state.provider }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  realpathSync: (path: string) => (path.endsWith('uploads') ? state.physicalRoot : path),
}))
vi.mock('@/lib/uploads/core/config-resolver', () => ({
  getStorageConfig: (context: string) => state.configs[context] ?? {},
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}))

const targetKey = 'workspace-target/kb-target/report.pdf'
const sourceKey = 'workspace-source/kb-source/report.pdf'
const copiedUrl = `/api/files/serve/s3/${encodeURIComponent(targetKey)}?context=knowledge-base`
const copyInput = {
  sourceFileUrl: `/api/files/serve/s3/${encodeURIComponent(sourceKey)}?context=knowledge-base`,
  targetWorkspaceId: 'workspace-target',
  targetKnowledgeBaseId: 'kb-target',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
}
function uploaded(key = targetKey) {
  return {
    path: `/api/files/serve/s3/${encodeURIComponent(key)}`,
    key,
    name: key,
    size: 11,
    type: 'application/pdf',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.provider = 's3'
  state.physicalRoot = 'fixture-original-root'
  state.configs = {
    copilot: { bucket: 'private-images' },
    general: { bucket: 'private-images' },
    'knowledge-base': { bucket: 'knowledge-disjoint' },
  }
  state.files.clear()
  vi.mocked(downloadFile).mockImplementation(async ({ key, context }) => {
    assertStorageReadAccess(key, context)
    state.providerReads(key)
    return Buffer.from('source file')
  })
  vi.mocked(uploadFile).mockImplementation(async (options) => {
    const key = options.customKey ?? options.fileName
    if (options.preventOverwrite && state.files.has(key)) throw new Error('Target already exists')
    state.files.set(key, options.file)
    return uploaded(key)
  })
  vi.mocked(deleteFile).mockImplementation(async ({ key, context }) => {
    assertStorageDeleteAccess(key, context)
    state.providerDeletes(key)
    state.files.delete(key)
  })
})

describe('knowledge document storage', () => {
  it('builds target keys and context-aware paths', () => {
    expect(buildKnowledgeStorageKey('workspace-1', 'kb-2', 'My Report!.pdf')).toBe(
      'workspace-1/kb-2/My-Report_.pdf'
    )
    expect(withKnowledgeStorageContext('/api/files/serve/key')).toBe(
      '/api/files/serve/key?context=knowledge-base'
    )
    expect(withKnowledgeStorageContext('/api/files/serve/key?context=knowledge-base')).toBe(
      '/api/files/serve/key?context=knowledge-base'
    )
    expect(withKnowledgeStorageContext('/api/files/serve/key?context=workflow&token=abc')).toBe(
      '/api/files/serve/key?context=knowledge-base&token=abc'
    )
  })

  it('copies safe source bytes with no overwrite and returns exact-target one-shot rollback', async () => {
    const copied = await copyKnowledgeDocumentFile(copyInput)
    expect(downloadFile).toHaveBeenCalledExactlyOnceWith({
      key: sourceKey,
      context: 'knowledge-base',
    })
    expect(uploadFile).toHaveBeenCalledExactlyOnceWith({
      file: Buffer.from('source file'),
      fileName: targetKey,
      contentType: 'application/pdf',
      context: 'knowledge-base',
      preserveKey: true,
      customKey: targetKey,
      preventOverwrite: true,
    })
    expect(copied.fileUrl).toBe(copiedUrl)
    expect(state.files.has(targetKey)).toBe(true)
    expect(deleteFile).not.toHaveBeenCalled()
    await Promise.all([copied.rollback(), copied.rollback()])
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith({
      key: targetKey,
      context: 'knowledge-base',
    })
    expect(state.providerDeletes).toHaveBeenCalledExactlyOnceWith(targetKey)
    expect(state.files.has(targetKey)).toBe(false)
  })

  it.each([
    '/api/files/serve/s3/private.png?context=copilot',
    '/api/files/serve/%70rivate.png?context=general',
    'https://private-images.s3.amazonaws.com/private.png',
    '/api/files/serve/archived%2Denhanced%2Dlogs%2Fprivate.png?context=knowledge-base',
    '/api/files/serve/key?context=workflow-archive',
  ])('refuses original protected source before key flattening: %s', async (sourceFileUrl) => {
    await expect(copyKnowledgeDocumentFile({ ...copyInput, sourceFileUrl })).rejects.toThrow()
    expect(downloadFile).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
    expect(state.providerReads).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('refuses a source whose actual knowledge destination is protected', async () => {
    state.configs['knowledge-base'] = { bucket: 'private-images' }
    await expect(copyKnowledgeDocumentFile(copyInput)).rejects.toThrow('File access')
    expect(downloadFile).not.toHaveBeenCalled()
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('never overwrites or mints rollback authority for an existing target', async () => {
    state.files.set(targetKey, Buffer.from('existing asset'))
    await expect(copyKnowledgeDocumentFile(copyInput)).rejects.toThrow('Target already exists')
    expect(state.files.get(targetKey)?.toString()).toBe('existing asset')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('refuses a nonmatching returned key without deleting an ambiguous target', async () => {
    vi.mocked(uploadFile).mockResolvedValueOnce(uploaded('different/owner/private.pdf'))
    await expect(copyKnowledgeDocumentFile(copyInput)).rejects.toThrow('target')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('refuses changed target configuration during upload without minting rollback authority', async () => {
    vi.mocked(uploadFile).mockImplementationOnce(async () => {
      state.configs['knowledge-base'] = { bucket: 'changed-target' }
      return uploaded()
    })
    await expect(copyKnowledgeDocumentFile(copyInput)).rejects.toThrow('target')
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it.each(['provider', 'config'])(
    'preserves the created target on %s drift before rollback',
    async (kind) => {
      const copied = await copyKnowledgeDocumentFile(copyInput)
      if (kind === 'provider') state.provider = 'azure'
      else state.configs['knowledge-base'] = { bucket: 'changed-target' }
      await expect(copied.rollback()).rejects.toThrow('target')
      state.provider = 's3'
      state.configs['knowledge-base'] = { bucket: 'knowledge-disjoint' }
      await copied.rollback()
      expect(deleteFile).not.toHaveBeenCalled()
      expect(state.files.has(targetKey)).toBe(true)
    }
  )

  it('permits rollback of a genuinely created target in shared private storage', async () => {
    state.configs['knowledge-base'] = { bucket: 'private-images' }
    const copied = await withAuthorizedStorageRead(sourceKey, 'copilot', () =>
      copyKnowledgeDocumentFile(copyInput)
    )
    await copied.rollback()
    expect(state.providerDeletes).toHaveBeenCalledExactlyOnceWith(targetKey)
    expect(state.files.has(targetKey)).toBe(false)
  })

  it('preserves a fresh local target when its physical root changes despite identical provider/config', async () => {
    state.provider = 'local'
    state.configs = { copilot: {}, general: {}, 'knowledge-base': {} }
    const copied = await withAuthorizedStorageRead(sourceKey, 'copilot', () =>
      copyKnowledgeDocumentFile(copyInput)
    )
    state.physicalRoot = 'fixture-replaced-root'

    await expect(copied.rollback()).rejects.toThrow('deletion')
    state.physicalRoot = 'fixture-original-root'
    await copied.rollback()

    expect(state.providerDeletes).not.toHaveBeenCalled()
    expect(state.files.has(targetKey)).toBe(true)
  })

  it('reports unique disjoint deletions and preserves provider failures', async () => {
    const otherUrl = '/api/files/serve/s3/other.pdf?context=knowledge-base'
    vi.mocked(deleteFile).mockRejectedValueOnce(new Error('missing blob'))
    const report = await deleteKnowledgeDocumentFiles([copiedUrl, copiedUrl, otherUrl])
    expect(report.deleted).toEqual([otherUrl])
    expect(report.retained).toEqual([{ fileUrl: copiedUrl, reason: expect.any(String) }])
    expect(deleteFile).toHaveBeenCalledTimes(2)
    expect(state.providerDeletes).toHaveBeenCalledExactlyOnceWith('other.pdf')
  })

  it.each([
    '/api/files/serve/s3/private.png?context=copilot',
    '/api/files/serve/%70rivate.png?context=general',
    'https://private-images.s3.amazonaws.com/private.png',
    '/api/files/serve/archived%2Denhanced%2Dlogs%2Fprivate.png?context=knowledge-base',
    '/api/files/serve/key?context=workflow-archive',
    'file:///tmp/uploads/private.png',
    'https://public.example/external.pdf',
  ])(
    'retains an unproved original delete reference before provider contact: %s',
    async (fileUrl) => {
      const report = await deleteKnowledgeDocumentFiles([fileUrl])
      expect(report).toEqual({ deleted: [], retained: [{ fileUrl, reason: expect.any(String) }] })
      expect(deleteFile).not.toHaveBeenCalled()
      expect(state.providerDeletes).not.toHaveBeenCalled()
    }
  )

  it('does not turn original READ authority into DELETE on a later disjoint knowledge target', async () => {
    const fileUrl = '/api/files/serve/s3/private.png?context=copilot'
    const report = await withAuthorizedStorageRead('private.png', 'copilot', () =>
      deleteKnowledgeDocumentFiles([fileUrl])
    )
    expect(report.deleted).toEqual([])
    expect(report.retained).toHaveLength(1)
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it.each(['protected', 'unknown'])(
    'retains raw references when actual knowledge destination is %s',
    async (kind) => {
      state.configs['knowledge-base'] = kind === 'protected' ? { bucket: 'private-images' } : {}
      const report = await deleteKnowledgeDocumentFiles([copiedUrl])
      expect(report.deleted).toEqual([])
      expect(report.retained).toHaveLength(1)
      expect(deleteFile).not.toHaveBeenCalled()
    }
  )

  it.each(['azure', 'vercel', 'local'])(
    'refuses shared %s copy/read/delete before storage contact',
    async (provider) => {
      state.provider = provider
      const shared: Record<string, string> =
        provider === 'azure'
          ? {
              connectionString:
                'BlobEndpoint=https://fixture.blob.core.windows.net/;SharedAccessSignature=sv=fixture',
              containerName: 'shared',
            }
          : provider === 'vercel'
            ? { token: 'fixture-token' }
            : {}
      state.configs = { copilot: shared, general: shared, 'knowledge-base': { ...shared } }

      await expect(copyKnowledgeDocumentFile(copyInput)).rejects.toThrow('File access')
      const report = await deleteKnowledgeDocumentFiles([copiedUrl])

      expect(report.deleted).toEqual([])
      expect(report.retained).toEqual([
        { fileUrl: copiedUrl, reason: expect.stringContaining('deletion') },
      ])
      expect(downloadFile).not.toHaveBeenCalled()
      expect(uploadFile).not.toHaveBeenCalled()
      expect(deleteFile).not.toHaveBeenCalled()
      expect(state.providerReads).not.toHaveBeenCalled()
      expect(state.providerDeletes).not.toHaveBeenCalled()
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function sourceContext(
  overrides: Partial<KnowledgeDocumentSourceContext> = {}
): KnowledgeDocumentSourceContext {
  return {
    workspaceId: 'workspace-source',
    knowledgeBaseId: 'kb-source',
    filename: 'report.pdf',
    reauthorize: vi.fn().mockResolvedValue(undefined),
    signal: new AbortController().signal,
    ...overrides,
  }
}
function sourceUrl(provider = state.provider, key = sourceKey) {
  return `https://app.fixture/api/files/serve/${provider === 'local' ? '' : `${provider}/`}${encodeURIComponent(key)}?context=knowledge-base`
}

describe('authorized canonical knowledge source acquisition', () => {
  it('rejects bad persisted source grammar before reauthorization or any IO', () => {
    const context = sourceContext()
    expect(() =>
      assertKnowledgeDocumentSource(sourceUrl('s3', 'foreign/kb/report.pdf'), 'report.pdf', context)
    ).toThrow('File access')
    expect(() =>
      assertKnowledgeDocumentSource(
        'https://private-images.s3.amazonaws.com/private.png',
        'report.pdf',
        context
      )
    ).toThrow('File access')
    expect(context.reauthorize).not.toHaveBeenCalled()
    expect(downloadFile).not.toHaveBeenCalled()
  })
  it.each(['s3', 'azure', 'vercel', 'local'])(
    'reads the exact canonical %s upload inside its capability, including shared storage',
    async (provider) => {
      state.provider = provider
      const shared: Record<string, string> =
        provider === 'azure'
          ? { accountName: 'fixture', containerName: 'shared' }
          : provider === 's3'
            ? { bucket: 'shared' }
            : {}
      state.configs = { copilot: shared, general: shared, 'knowledge-base': shared }
      const context = sourceContext()
      expect(await readKnowledgeDocumentSource(sourceUrl(), 'report.pdf', context)).toEqual(
        Buffer.from('source file')
      )
      expect(downloadFile).toHaveBeenCalledExactlyOnceWith({
        key: sourceKey,
        context: 'knowledge-base',
        signal: context.signal,
      })
      expect(context.reauthorize).toHaveBeenCalledTimes(2)
      await expect(downloadFile({ key: sourceKey, context: 'knowledge-base' })).rejects.toThrow(
        'File access'
      )
      expect(state.providerReads).toHaveBeenCalledExactlyOnceWith(sourceKey)
    }
  )

  it.each([
    'https://app.fixture/api/files/serve/s3/workspace-other%2Fkb-source%2Freport.pdf?context=knowledge-base',
    'https://app.fixture/api/files/serve/s3/workspace-source%2Fkb-other%2Freport.pdf?context=knowledge-base',
    'https://app.fixture/api/files/serve/s3/workspace-source%2Fkb-source%2Freport.pdf?context=copilot',
    'https://app.fixture/api/files/serve/s3/workspace-source%2Fkb-source%2Freport.pdf?context=knowledge-base&context=copilot',
    'https://foreign.fixture/api/files/serve/s3/workspace-source%2Fkb-source%2Freport.pdf?context=knowledge-base',
    'https://app.fixture/api/files/serve/azure/workspace-source%2Fkb-source%2Freport.pdf?context=knowledge-base',
    'https://app.fixture/api/files/serve/s3/workspace-source%252Fkb-source%252Freport.pdf?context=knowledge-base',
    'https://app.fixture/api/files/serve/s3/archived%2Denhanced%2Dlogs%2Freport.pdf?context=knowledge-base',
    'file:///uploads/report.pdf',
    '/uploads/report.pdf',
    'data:text/plain;base64,aGVsbG8=',
    'https://app.fixture/api/files/serve/s3/%zz?context=knowledge-base',
  ])('refuses unproved or malformed original source before IO: %s', async (url) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(readKnowledgeDocumentSource(url, 'report.pdf', sourceContext())).rejects.toThrow()
    expect(downloadFile).not.toHaveBeenCalled()
    expect(state.providerReads).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('denies an archive physical destination even for the correct current KB key', async () => {
    vi.stubEnv('WORKFLOW_ARCHIVE_S3_BUCKET', 'knowledge-disjoint')
    await expect(
      readKnowledgeDocumentSource(sourceUrl(), 'report.pdf', sourceContext())
    ).rejects.toThrow('archives')
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('refuses mismatched actual filename and failed fresh authorization before IO', async () => {
    await expect(
      readKnowledgeDocumentSource(
        sourceUrl(),
        'report.pdf',
        sourceContext({ filename: 'other.pdf' })
      )
    ).rejects.toThrow('File access')
    const denied = Object.assign(new Error('Current KB access denied'), { status: 403 })
    await expect(
      readKnowledgeDocumentSource(
        sourceUrl(),
        'report.pdf',
        sourceContext({ reauthorize: vi.fn().mockRejectedValue(denied) })
      )
    ).rejects.toBe(denied)
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('reauthorizes after direct IO without returning bytes after revocation', async () => {
    const denied = Object.assign(new Error('Revoked during read'), { status: 403 })
    const context = sourceContext({
      reauthorize: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied),
    })
    await expect(readKnowledgeDocumentSource(sourceUrl(), 'report.pdf', context)).rejects.toBe(
      denied
    )
    expect(state.providerReads).toHaveBeenCalledExactlyOnceWith(sourceKey)
  })

  it('rejects target or physical-root drift through the read', async () => {
    state.provider = 'local'
    state.configs = { copilot: {}, general: {}, 'knowledge-base': {} }
    vi.mocked(downloadFile).mockImplementationOnce(async ({ key, context }) => {
      assertStorageReadAccess(key, context)
      state.physicalRoot = 'fixture-replaced-root'
      return Buffer.from('must not return')
    })
    await expect(
      readKnowledgeDocumentSource(sourceUrl(), 'report.pdf', sourceContext())
    ).rejects.toThrow('File access')
  })

  it('uses guarded public redirects without any source credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://public.fixture/final.pdf' },
        })
      )
      .mockResolvedValueOnce(new Response('verified public bytes'))
    vi.stubGlobal('fetch', fetcher)
    expect(
      await readKnowledgeDocumentSource(
        'https://public.fixture/first.pdf',
        'report.pdf',
        sourceContext()
      )
    ).toEqual(Buffer.from('verified public bytes'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [, options] of fetcher.mock.calls) {
      expect(options.redirect).toBe('manual')
      expect(options.headers).toBeUndefined()
    }
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('denies a public redirect to protected storage before its second contact', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://private-images.s3.amazonaws.com/private.png' },
      })
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(
      readKnowledgeDocumentSource('https://public.fixture/first.pdf', 'report.pdf', sourceContext())
    ).rejects.toThrow('File access')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(downloadFile).not.toHaveBeenCalled()
  })

  it('does not forward bearer credentials to a deceptive matching pathname host', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      readKnowledgeDocumentSource(
        'https://attacker.fixture/api/files/serve/s3/private.png?context=knowledge-base',
        'report.pdf',
        sourceContext()
      )
    ).rejects.toThrow('File access')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('withholds bytes after a signal abort during direct acquisition', async () => {
    const controller = new AbortController()
    vi.mocked(downloadFile).mockImplementationOnce(async () => {
      controller.abort(new Error('Cancelled source'))
      return Buffer.from('must not return')
    })
    await expect(
      readKnowledgeDocumentSource(
        sourceUrl(),
        'report.pdf',
        sourceContext({ signal: controller.signal })
      )
    ).rejects.toThrow('Cancelled source')
  })
})
