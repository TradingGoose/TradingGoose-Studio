import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(
  () =>
    ({
      WORKFLOW_ARCHIVE_PROVIDER: 'local',
      WORKFLOW_ARCHIVE_PRIVATE_VERIFIED: true,
      WORKFLOW_ARCHIVE_LOCAL_ROOT: '',
    }) as Record<string, any>
)
vi.mock('@/lib/env', () => ({
  env: settings,
  isTruthy: (value: unknown) => value === true || value === 'true',
}))

import { readPrivateArchive, writePrivateArchive } from './io'

const scope = { workspaceId: 'workspace', executionId: 'execution', logId: 'log' }
let root = ''
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = ''
  settings.WORKFLOW_ARCHIVE_PRIVATE_VERIFIED = true
  settings.WORKFLOW_ARCHIVE_LOCAL_ROOT = ''
})
describe('internal private archive local IO', () => {
  it('writes immutable private content-bound artifacts and verifies readback without public URLs', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'workflow-archive-'))
    settings.WORKFLOW_ARCHIVE_LOCAL_ROOT = root
    const payload = {
      output: { value: '🔥 \n' },
      functional: { blocks: [], output: { done: true } },
      checkpoint: { encrypted: 'secret-ciphertext' },
    }
    const ref = await writePrivateArchive(scope, payload)
    expect(await readPrivateArchive(ref)).toEqual(payload)
    expect(await writePrivateArchive(scope, payload)).toEqual(ref)
    expect(ref).not.toHaveProperty('url')
    expect(ref).not.toHaveProperty('token')
    expect((await stat(path.join(root, ref.key))).mode & 0o777).toBe(0o600)
    await writeFile(path.join(root, ref.key), 'corrupt')
    await expect(readPrivateArchive(ref)).rejects.toThrow('digest')
    await expect(writePrivateArchive(scope, payload)).rejects.toThrow('digest')
    expect(await readFile(path.join(root, ref.key), 'utf8')).toBe('corrupt')
  })
  it('keeps handoff closed with unverified/missing/public/symlink destinations', async () => {
    settings.WORKFLOW_ARCHIVE_PRIVATE_VERIFIED = false
    await expect(writePrivateArchive(scope, {})).rejects.toThrow('verified')
    settings.WORKFLOW_ARCHIVE_PRIVATE_VERIFIED = true
    await expect(writePrivateArchive(scope, {})).rejects.toThrow('absolute')
    settings.WORKFLOW_ARCHIVE_LOCAL_ROOT = path.resolve(process.cwd(), 'uploads', 'private')
    await expect(writePrivateArchive(scope, {})).rejects.toThrow('outside')
    root = await mkdtemp(path.join(tmpdir(), 'workflow-archive-'))
    await mkdir(path.join(root, 'real'))
    await symlink(path.join(root, 'real'), path.join(root, 'alias'))
    settings.WORKFLOW_ARCHIVE_LOCAL_ROOT = path.join(root, 'alias')
    await expect(writePrivateArchive(scope, {})).rejects.toThrow('symlink')
  })
})
