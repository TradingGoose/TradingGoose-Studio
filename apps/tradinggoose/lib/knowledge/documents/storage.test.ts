import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteFile, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import {
  buildKnowledgeStorageKey,
  copyKnowledgeDocumentFile,
  deleteKnowledgeDocumentFiles,
  withKnowledgeStorageContext,
} from './storage'

vi.mock('@/lib/uploads/core/storage-service', () => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}))

describe('knowledge document storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds owned keys and context-aware paths', () => {
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

  it('copies internal document files to the target workspace knowledge base', async () => {
    vi.mocked(downloadFile).mockResolvedValue(Buffer.from('source file'))
    vi.mocked(uploadFile).mockResolvedValue({
      path: '/api/files/serve/vercel/workspace-target%2Fkb-target%2Freport.pdf',
      key: 'workspace-target/kb-target/report.pdf',
      name: 'workspace-target/kb-target/report.pdf',
      size: 11,
      type: 'application/pdf',
    })

    const copiedUrl = await copyKnowledgeDocumentFile({
      sourceFileUrl:
        'https://app.tradinggoose.ai/api/files/serve/vercel/workspace-source%2Fkb-source%2Freport.pdf?context=knowledge-base',
      targetWorkspaceId: 'workspace-target',
      targetKnowledgeBaseId: 'kb-target',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    })

    expect(downloadFile).toHaveBeenCalledWith({
      key: 'workspace-source/kb-source/report.pdf',
      context: 'knowledge-base',
    })
    expect(uploadFile).toHaveBeenCalledWith({
      file: Buffer.from('source file'),
      fileName: 'workspace-target/kb-target/report.pdf',
      contentType: 'application/pdf',
      context: 'knowledge-base',
      preserveKey: true,
      customKey: 'workspace-target/kb-target/report.pdf',
    })
    expect(copiedUrl).toBe(
      '/api/files/serve/vercel/workspace-target%2Fkb-target%2Freport.pdf?context=knowledge-base'
    )
  })

  it('deletes unique owned internal document files from knowledge storage', async () => {
    vi.mocked(deleteFile).mockResolvedValue(undefined)

    await deleteKnowledgeDocumentFiles([
      '/api/files/serve/vercel/workspace-1%2Fkb-1%2Freport.pdf?context=knowledge-base',
      '/api/files/serve/vercel/workspace-1%2Fkb-1%2Freport.pdf?context=knowledge-base',
      'https://example.com/external.pdf',
    ])

    expect(deleteFile).toHaveBeenCalledTimes(1)
    expect(deleteFile).toHaveBeenCalledWith({
      key: 'workspace-1/kb-1/report.pdf',
      context: 'knowledge-base',
    })
  })
})
