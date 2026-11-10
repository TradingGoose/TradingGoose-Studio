/** @vitest-environment node */

import { getTableName, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: vi.fn(),
  providerDelete: vi.fn(),
  decrement: vi.fn(),
  workspaceReads: 0,
  revokeBetweenChecks: false,
  rows: [] as Record<string, unknown>[],
  permissions: [] as Record<string, unknown>[],
  workspaces: [] as Record<string, unknown>[],
  injectedFile: null as Record<string, unknown> | null,
  queryError: false,
  sql: [] as { table: string; text: string; params: unknown[]; operation: string }[],
  deletes: 0,
}))
function predicate(table: string, condition: SQL, operation: string) {
  const query = new PgDialect().sqlToQuery(condition)
  state.sql.push({ table, text: query.sql, params: query.params, operation })
  if (table === 'workspace') {
    expect(query.sql).toBe('"workspace"."id" = $1')
    state.workspaceReads++
    return state.workspaces.filter((row) => row.id === query.params[0])
  }
  if (table === 'permissions') {
    expect(query.sql).toContain('"permissions"."user_id" = $1')
    expect(query.sql).toContain('"permissions"."entity_type" = $2')
    expect(query.sql).toContain('"permissions"."entity_id" = $3')
    if (state.revokeBetweenChecks && state.workspaceReads >= 2) return []
    return state.permissions.filter(
      (row) =>
        row.userId === query.params[0] &&
        row.entityType === query.params[1] &&
        row.entityId === query.params[2]
    )
  }
  expect(table).toBe('workspace_file')
  expect(query.sql).toContain('"workspace_file"."id" = $1')
  expect(query.sql).toContain('"workspace_file"."workspace_id" = $2')
  expect(query.params).toHaveLength(2)
  if (state.queryError) throw new Error('Database unavailable')
  const found = state.rows.filter(
    (row) => row.id === query.params[0] && row.workspaceId === query.params[1]
  )
  if (operation === 'delete') {
    state.deletes++
    state.rows = state.rows.filter((row) => !found.includes(row))
  }
  return operation === 'select' && state.injectedFile ? [state.injectedFile] : found
}
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: (condition: SQL) => ({
          limit: async (limit: number) =>
            predicate(getTableName(table), condition, 'select').slice(0, limit),
          then: (
            resolve: (rows: Record<string, unknown>[]) => unknown,
            reject: (error: unknown) => unknown
          ) =>
            Promise.resolve()
              .then(() => predicate(getTableName(table), condition, 'select'))
              .then(resolve, reject),
        }),
      }),
    }),
    delete: (table: Parameters<typeof getTableName>[0]) => ({
      where: async (condition: SQL) => predicate(getTableName(table), condition, 'delete'),
    }),
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: state.session }))
vi.mock('@/lib/billing/storage', () => ({
  decrementStorageUsage: state.decrement,
  incrementStorageUsage: vi.fn(),
  checkStorageQuota: vi.fn(),
}))
vi.mock('@/lib/env', () => ({
  env: {
    STORAGE_PROVIDER: 'vercel',
    VERCEL_BLOB_READ_WRITE_TOKEN: 'synthetic-token',
    VERCEL_BLOB_ACCESS: 'private',
  },
}))
vi.mock('@/lib/uploads', () => ({ getServePathPrefix: () => '/api/files/serve/vercel/' }))
vi.mock('@vercel/blob', () => ({ del: state.providerDelete, get: vi.fn(), put: vi.fn() }))

import { DELETE } from './route'

const actor = 'current-writer'
const workspaceId = 'workspace-1'
const fileId = 'file-1'
const original = () => ({
  id: fileId,
  workspaceId,
  name: 'owned.png',
  key: 'flat-shared-private-key.png',
  size: 70,
  type: 'image/png',
  uploadedBy: 'original-uploader',
  uploadedAt: new Date(0),
})
const permission = (permissionType = 'write', id = workspaceId) => ({
  userId: actor,
  entityType: 'workspace',
  entityId: id,
  permissionType,
})
const call = (id = workspaceId, file = fileId) =>
  DELETE(
    new NextRequest(`https://studio.example/api/workspaces/${id}/files/${file}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id, fileId: file }) }
  )
const noMutation = () => {
  expect(state.providerDelete).not.toHaveBeenCalled()
  expect(state.deletes).toBe(0)
  expect(state.decrement).not.toHaveBeenCalled()
  expect(state.rows).toHaveLength(1)
}
beforeEach(() => {
  vi.resetAllMocks()
  state.workspaceReads = 0
  state.revokeBetweenChecks = false
  state.injectedFile = null
  state.queryError = false
  state.sql = []
  state.deletes = 0
  state.session.mockResolvedValue({ user: { id: actor } })
  state.providerDelete.mockResolvedValue(undefined)
  state.decrement.mockResolvedValue(undefined)
  state.workspaces = [{ id: workspaceId, ownerId: 'different-owner', name: 'Synthetic workspace' }]
  state.permissions = [permission()]
  state.rows = [original()]
})

describe('canonical workspace-file deletion actual route/helper/guard', () => {
  it.each(['write', 'admin'])(
    'allows the current %s writer only through the exact row, DELETE purpose and actual provider before scoped row/counter deletion',
    async (level) => {
      state.permissions = [permission(level)]
      const response = await call()
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ success: true })
      expect(state.workspaceReads).toBe(2)
      expect(state.providerDelete).toHaveBeenCalledExactlyOnceWith(original().key, {
        token: 'synthetic-token',
      })
      expect(state.sql.filter((query) => query.table === 'workspace_file')).toEqual([
        expect.objectContaining({ operation: 'select', params: [fileId, workspaceId] }),
        expect.objectContaining({ operation: 'delete', params: [fileId, workspaceId] }),
      ])
      expect(state.rows).toEqual([])
      expect(state.decrement).toHaveBeenCalledExactlyOnceWith('original-uploader', 70, workspaceId)
    }
  )
  it('allows a current workspace owner without manufacturing a permission row', async () => {
    state.workspaces[0].ownerId = actor
    state.permissions = []
    expect((await call()).status).toBe(200)
    expect(state.workspaceReads).toBe(2)
    expect(state.providerDelete).toHaveBeenCalledOnce()
  })
  it('refuses an unauthenticated caller before DB/provider/counter mutation', async () => {
    state.session.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(state.sql).toEqual([])
    noMutation()
  })
  it.each(['read', 'revoked', 'absent-workspace'])(
    'refuses %s authorization before row lookup and transport',
    async (mode) => {
      if (mode === 'read') state.permissions = [permission('read')]
      if (mode === 'revoked') state.permissions = []
      if (mode === 'absent-workspace') state.workspaces = []
      expect((await call()).status).toBe(403)
      expect(state.sql.some((query) => query.table === 'workspace_file')).toBe(false)
      noMutation()
    }
  )
  it('rechecks fresh authorization between the route and helper and preserves the object on revocation', async () => {
    state.revokeBetweenChecks = true
    expect((await call()).status).toBe(403)
    expect(state.workspaceReads).toBe(2)
    expect(state.sql.some((query) => query.table === 'workspace_file')).toBe(false)
    noMutation()
  })
  it.each(['wrong-workspace', 'wrong-file', 'missing-row'])(
    'refuses %s through actual scoped SQL with zero physical or row deletion',
    async (mode) => {
      if (mode === 'wrong-workspace') {
        state.workspaces.push({ id: 'other-workspace', ownerId: actor })
        expect((await call('other-workspace')).status).toBe(403)
      } else if (mode === 'wrong-file')
        expect((await call(workspaceId, 'other-file')).status).toBe(403)
      else {
        state.rows = []
        expect((await call()).status).toBe(403)
      }
      expect(state.providerDelete).not.toHaveBeenCalled()
      expect(state.deletes).toBe(0)
      expect(state.decrement).not.toHaveBeenCalled()
      expect(state.sql.find((query) => query.table === 'workspace_file')).toMatchObject({
        operation: 'select',
        params: [
          mode === 'wrong-file' ? 'other-file' : fileId,
          mode === 'wrong-workspace' ? 'other-workspace' : workspaceId,
        ],
      })
    }
  )
  it.each(['id', 'workspaceId'])(
    'refuses an inconsistent returned %s even after a correctly scoped query',
    async (field) => {
      state.injectedFile = { ...original(), [field]: 'malformed-off-scope' }
      expect((await call()).status).toBe(403)
      noMutation()
    }
  )
  it('preserves the canonical row/counter when the actual provider refuses deletion', async () => {
    state.providerDelete.mockRejectedValueOnce(new Error('Provider refused deletion'))
    const response = await call()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Provider refused deletion'),
    })
    expect(state.providerDelete).toHaveBeenCalledOnce()
    expect(state.deletes).toBe(0)
    expect(state.decrement).not.toHaveBeenCalled()
    expect(state.rows).toHaveLength(1)
  })
  it('refuses a failed real row lookup instead of promoting a caller key or proof', async () => {
    state.queryError = true
    expect((await call()).status).toBe(403)
    noMutation()
  })
  it('keeps archive lifetime exclusions even for a current writer and exact row', async () => {
    state.rows[0].key = 'archived-enhanced-logs/private'
    expect((await call()).status).toBe(500)
    noMutation()
  })
})
