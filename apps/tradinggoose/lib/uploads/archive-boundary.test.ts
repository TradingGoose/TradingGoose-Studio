import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertPublicStorageContext,
  assertPublicStorageInput,
  fetchPublicStorageUrl,
} from './archive-boundary'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
describe('private workflow archive denial through generic storage', () => {
  it.each([
    'archived-enhanced-logs/day/log.json',
    '12345-archived-enhanced-logs/day/log.json',
    '9e94df50-aaaa-bbbb-cccc-68b7a3df035e-archived-enhanced-logs_day_log.json',
    '/api/files/serve/s3/archived-enhanced-logs%2Fday%2Flog.json',
    '%61rchived-enhanced-logs%2Fday%2Flog.json',
    'archived-enhanced-logs%252Fday%252Flog.json',
    'foo/../archived-enhanced-logs/day/log.json',
    'archived-enhanced-logs\\day\\log.json',
    'foo%00bar',
    'broken%zz',
    'foo/%2e%2e/file',
  ])('rejects namespace/known generated alias/ambiguous encoding %s', (input) => {
    for (const context of ['general', 'execution', 'workspace', undefined])
      expect(() => assertPublicStorageInput(input, context)).toThrow()
  })
  it('refuses internal and unknown contexts rather than falling back', () => {
    for (const context of ['workflow-archive', 'unknown', {}, null])
      expect(() => assertPublicStorageContext(context)).toThrow()
    expect(() => assertPublicStorageInput('ordinary.txt', 'workspace')).not.toThrow()
    expect(() =>
      assertPublicStorageInput('/api/files/serve/s3/workspace%2Fordinary.txt', 'workspace')
    ).not.toThrow()
  })
  it('rejects configured private destinations even with ordinary object names and spoofed public context', () => {
    vi.stubEnv('WORKFLOW_ARCHIVE_S3_BUCKET', 'private-archive')
    vi.stubEnv('WORKFLOW_ARCHIVE_AZURE_CONTAINER', 'private-archive')
    vi.stubEnv('WORKFLOW_ARCHIVE_AZURE_ACCOUNT', 'private-account')
    vi.stubEnv(
      'WORKFLOW_ARCHIVE_VERCEL_ORIGIN',
      'https://private-store.private.blob.vercel-storage.com'
    )
    vi.stubEnv('WORKFLOW_ARCHIVE_VERCEL_TOKEN', 'private-token')
    for (const value of [
      'https://private-archive.s3.us-east-1.amazonaws.com/ordinary.txt',
      'https://s3.amazonaws.com/private-archive/ordinary.txt',
      'https://private-account.blob.core.windows.net/private-archive/ordinary.txt',
      'https://private-store.private.blob.vercel-storage.com/ordinary.txt',
    ])
      expect(() => assertPublicStorageInput(value, 'general')).toThrow()
    for (const config of [
      { bucket: 'private-archive' },
      { containerName: 'private-archive' },
      { token: 'private-token' },
    ])
      expect(() => assertPublicStorageInput('ordinary.txt', 'general', config)).toThrow()
  })
  it('checks each redirect before a second fetch, including otherwise unrelated proxy hosts', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://files.example/archived-enhanced-logs/data.json' },
        })
    )
    vi.stubGlobal('fetch', fetch)
    await expect(fetchPublicStorageUrl('https://ordinary.example/redirect')).rejects.toThrow(
      'archives'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://ordinary.example/redirect',
      expect.objectContaining({ redirect: 'manual' })
    )
  })
})

it('reauthorizes every redirect hop and refuses revocation before second target contact', async () => {
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('revoked'))
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://public.example/next' } })
    )
  vi.stubGlobal('fetch', fetch)
  await expect(
    fetchPublicStorageUrl('https://public.example/first', {}, authorize)
  ).rejects.toThrow('revoked')
  expect(authorize).toHaveBeenCalledTimes(2)
  expect(fetch).toHaveBeenCalledOnce()
})
