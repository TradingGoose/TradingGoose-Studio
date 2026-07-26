/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTransaction } = vi.hoisted(() => ({ mockTransaction: vi.fn() }))

vi.mock('@tradinggoose/db', () => ({
  db: { transaction: mockTransaction },
}))

describe('Yjs revocation fence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('holds normalized exclusive targets through drain and mutation', async () => {
    const events: string[] = []
    const statements: string[] = []
    const tx = {
      execute: vi.fn(async (statement) => {
        statements.push(JSON.stringify(statement))
        events.push('lock')
        return []
      }),
    }
    mockTransaction.mockImplementation((run) => run(tx))
    const { runYjsRevocationTransaction } = await import('./revocation-fence')

    await runYjsRevocationTransaction(
      {
        sessionIds: ['session-b', 'session-a', 'session-a'],
        workspaceIds: [' workspace-a '],
      },
      async (target) => {
        expect(target).toEqual({
          sessionIds: ['session-a', 'session-b'],
          workspaceIds: ['workspace-a'],
        })
        events.push('drain')
      },
      async (received) => {
        expect(received).toBe(tx)
        events.push('mutation')
      }
    )

    expect(statements[0]).toMatch(
      /statement_timeout.*60000.*idle_in_transaction_session_timeout.*60000/s
    )
    expect(statements[0]).toMatch(/transaction_timeout.*60000/)
    expect(statements[1]).toContain('session:session-a')
    expect(statements[2]).toContain('session:session-b')
    expect(statements[3]).toContain('workspace:workspace-a')
    expect(events.slice(-2)).toEqual(['drain', 'mutation'])
  })

  it('holds shared session and discovered workspace targets during admission', async () => {
    const statements: string[] = []
    const tx = {
      execute: vi.fn(async (statement) => {
        statements.push(JSON.stringify(statement))
        return [{ acquired: true }]
      }),
      select: vi.fn(),
    }
    mockTransaction.mockImplementation((run) => run(tx))
    const { withYjsAdmissionTransaction } = await import('./revocation-fence')

    await withYjsAdmissionTransaction({ sessionIds: ['watchlist-1'] }, async (admit, store) => {
      expect(store).toBe(tx)
      await admit({ workspaceIds: ['workspace-1'] })
      await admit({ workspaceIds: ['workspace-1'] })
    })

    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain('session:watchlist-1')
    expect(statements[1]).toContain('workspace:workspace-1')
  })

  it('rejects a fresh runtime admission while another process owns the exclusive fence', async () => {
    mockTransaction.mockImplementation((run) =>
      run({ execute: vi.fn(async () => [{ acquired: false }]) })
    )
    const { withYjsAdmissionTransaction } = await import('./revocation-fence')

    await expect(
      withYjsAdmissionTransaction({ sessionIds: ['watchlist-1'] }, async () => undefined)
    ).rejects.toMatchObject({ name: 'YjsSessionAdmissionError', status: 425 })
  })
})
