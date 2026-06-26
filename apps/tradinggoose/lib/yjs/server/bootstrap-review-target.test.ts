/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const mocks = vi.hoisted(() => {
  class SocketServerBridgeError extends Error {
    constructor(
      public status: number,
      public body: string
    ) {
      super(`Bridge failed: ${status}`)
    }
  }

  return { getEntityFields: vi.fn(), getYjsSnapshot: vi.fn(), SocketServerBridgeError }
})

vi.mock('@/lib/workflows/db-helpers', () => ({ loadWorkflowBootstrapStateFromDb: vi.fn() }))
vi.mock('@/lib/yjs/entity-session', () => ({
  getEntityFields: (...args: unknown[]) => mocks.getEntityFields(...args),
  seedEntitySession: vi.fn(),
}))
vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readSavedEntityFieldsFromDb: vi.fn(),
  resolveEntityWorkspaceId: vi.fn(),
}))
vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  getYjsSnapshot: (...args: unknown[]) => mocks.getYjsSnapshot(...args),
  SocketServerBridgeError: mocks.SocketServerBridgeError,
}))

const snapshot = () => {
  const doc = new Y.Doc()
  const snapshotBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
  doc.destroy()
  return { snapshotBase64 }
}

describe('buildSavedEntityListThroughYjs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getEntityFields.mockReturnValue({ name: 'live' })
    mocks.getYjsSnapshot.mockResolvedValue(snapshot())
  })

  it('skips row-local missing snapshots and invalid projections', async () => {
    mocks.getYjsSnapshot
      .mockRejectedValueOnce(new mocks.SocketServerBridgeError(404, 'missing'))
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot())

    const { buildSavedEntityListThroughYjs } = await import('./bootstrap-review-target')
    const result = await buildSavedEntityListThroughYjs(
      'skill',
      [
        { id: 'missing', workspaceId: 'workspace-1' },
        { id: 'invalid', workspaceId: 'workspace-1' },
        { id: 'live', workspaceId: 'workspace-1' },
      ],
      (row, fields) => {
        if (row.id === 'invalid') throw new Error('invalid fields')
        return { id: row.id, name: fields.name }
      }
    )

    expect(result).toEqual([{ id: 'live', name: 'live' }])
  })

  it('keeps realtime bridge outages as list-level failures', async () => {
    mocks.getYjsSnapshot.mockRejectedValue(new mocks.SocketServerBridgeError(500, 'down'))

    const { buildSavedEntityListThroughYjs } = await import('./bootstrap-review-target')

    await expect(
      buildSavedEntityListThroughYjs('skill', [{ id: 'skill-1', workspaceId: 'workspace-1' }])
    ).rejects.toThrow('Bridge failed: 500')
  })
})
