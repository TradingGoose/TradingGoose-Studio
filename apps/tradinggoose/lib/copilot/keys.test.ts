import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  lock: vi.fn(),
  active: vi.fn(),
  insert: vi.fn(),
  list: vi.fn(),
  revoke: vi.fn(),
}))
vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'test-purpose-key-pepper' } }))
vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        select: () => ({
          from: () => ({
            where: () => ({
              for: m.lock,
              then: (resolve: (value: unknown) => void) => m.active().then(resolve),
            }),
          }),
        }),
        insert: () => ({ values: m.insert }),
      }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: m.list }) }) }),
    update: () => ({
      set: (value: unknown) => ({ where: () => ({ returning: () => m.revoke(value) }) }),
    }),
  },
}))

import { createCopilotApiKey, listCopilotApiKeys, revokeCopilotApiKey } from './keys'

beforeEach(() => {
  vi.resetAllMocks()
  m.lock.mockResolvedValue([{ id: 'actor' }])
  m.active.mockResolvedValue([])
  m.insert.mockResolvedValue(undefined)
  m.list.mockResolvedValue([])
  m.revoke.mockResolvedValue([{ id: 'key-id' }])
})
describe('canonical Copilot credential ownership', () => {
  it('uses existing format, exact HMAC pepper and canonical ownership without copying plaintext into rows', async () => {
    const result = await createCopilotApiKey('actor')
    const row = m.insert.mock.calls[0]![0]
    expect(m.lock).toHaveBeenCalledWith('update')
    expect(row).toMatchObject({ userId: 'actor', status: 'active', id: result.id })
    const prefix = `tgc_${row.publicId}_`
    expect(result.apiKey.startsWith(prefix)).toBe(true)
    const secret = result.apiKey.slice(prefix.length)
    expect(row.secretHash).toBe(
      createHmac('sha256', 'test-purpose-key-pepper').update(secret).digest('hex')
    )
    expect(row.suffix).toBe(secret.slice(-6))
    expect(row.apiKey).toBeUndefined()
    expect(row.secret).toBeUndefined()
  })
  it('refuses nonexistent owner and bounded active count before insert', async () => {
    m.lock.mockResolvedValueOnce([])
    await expect(createCopilotApiKey('actor')).rejects.toThrow('owner')
    expect(m.insert).not.toHaveBeenCalled()
    m.active.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => ({ id: String(index) }))
    )
    await expect(createCopilotApiKey('actor')).rejects.toThrow('maximum')
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('reads retained revocation and expiry fields without rewriting stored keys or hashes', async () => {
    const rows = [
      {
        id: 'retained',
        suffix: 'suffix',
        status: 'revoked',
        revokedAt: '2026-01-01',
        expiresAt: '2026-02-01',
      },
    ]
    m.list.mockResolvedValue(rows)
    expect(await listCopilotApiKeys('actor')).toEqual(rows)
    expect(m.insert).not.toHaveBeenCalled()
    expect(m.revoke).not.toHaveBeenCalled()
  })
  it('revokes by owner/key scope without destroying identity or hash evidence', async () => {
    expect(await revokeCopilotApiKey('key-id', 'actor')).toBe(true)
    expect(m.revoke).toHaveBeenCalledWith({ status: 'revoked', revokedAt: expect.any(String) })
    m.revoke.mockResolvedValueOnce([])
    expect(await revokeCopilotApiKey('foreign', 'actor')).toBe(false)
  })
})
