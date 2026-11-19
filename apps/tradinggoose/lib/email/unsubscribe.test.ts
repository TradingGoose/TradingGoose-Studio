import { user } from '@tradinggoose/db/schema'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/email/unsubscribe'
import { GET, POST } from '@/app/api/users/me/settings/unsubscribe/route'

const { select, lock, write, transaction } = vi.hoisted(() => ({
  select: vi.fn(),
  lock: vi.fn(),
  write: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({ db: { select, transaction } }))
vi.mock('@/lib/env', () => ({ env: { BETTER_AUTH_SECRET: 'test-secret-key' } }))

const mailbox = {
  id: 'original-account',
  email: 'test@example.com',
  emailVerified: true,
  preferences: { unsubscribeUpdates: true },
}

describe('unsubscribe tokens', () => {
  it('signs the mailbox and email type with a unique salt', () => {
    const token = generateUnsubscribeToken(mailbox, 'marketing')

    expect(verifyUnsubscribeToken(mailbox, token)).toBe('marketing')
    expect(generateUnsubscribeToken(mailbox, 'marketing')).not.toBe(token)
    expect(verifyUnsubscribeToken(mailbox, token.replace('marketing', 'updates'))).toBeNull()
    expect(verifyUnsubscribeToken({ ...mailbox, email: 'other@example.com' }, token)).toBeNull()
    expect(verifyUnsubscribeToken(mailbox, `${token}:extra`)).toBeNull()
  })
})

describe('unsubscribe route', () => {
  const url = 'http://localhost/api/users/me/settings/unsubscribe'
  const token = generateUnsubscribeToken(mailbox, 'marketing')
  const params = new URLSearchParams({ email: mailbox.email, token })
  const get = () => GET(new NextRequest(`${url}?${params}`))
  const post = () =>
    POST(
      new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify({ email: mailbox.email, token, type: 'marketing' }),
      })
    )

  const oneClick = (body: URLSearchParams | FormData, challenge = token) =>
    POST(
      new NextRequest(`${url}?${new URLSearchParams({ email: mailbox.email, token: challenge })}`, {
        method: 'POST',
        body,
      })
    )

  beforeEach(() => {
    vi.clearAllMocks()
    select.mockImplementation(() => ({
      from: () => ({ leftJoin: () => ({ where: () => ({ limit: () => [mailbox] }) }) }),
    }))
    lock.mockResolvedValue([mailbox])
    transaction.mockImplementation(async (run) =>
      run({
        select: () => ({
          from: () => ({ leftJoin: () => ({ where: () => ({ limit: () => ({ for: lock }) }) }) }),
        }),
        insert: () => ({ values: write }),
      })
    )
    write.mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(null) })
  })

  it('reads preferences and writes to the mailbox owner under the row lock', async () => {
    const readResponse = await get()
    const writeResponse = await post()

    expect(await readResponse.json()).toMatchObject({ currentPreferences: mailbox.preferences })
    expect(writeResponse.status).toBe(200)
    expect(lock).toHaveBeenCalledWith('update', { of: user })
    expect(write).toHaveBeenCalledWith({
      id: mailbox.id,
      userId: mailbox.id,
      emailPreferences: { unsubscribeMarketing: true },
    })
  })

  it.each([new URLSearchParams(), new FormData()])(
    'accepts RFC 8058 form submissions for the signed list',
    async (form) => {
      form.set('List-Unsubscribe', 'One-Click')
      const response = await oneClick(form, generateUnsubscribeToken(mailbox, 'notifications'))
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('')
      expect(write).toHaveBeenCalledWith({
        id: mailbox.id,
        userId: mailbox.id,
        emailPreferences: { unsubscribeNotifications: true },
      })
    }
  )

  it('requires a one-click instruction and leaves preferences untouched on GET', async () => {
    expect((await get()).status).toBe(200)
    expect((await oneClick(new URLSearchParams())).status).toBe(400)
    expect(write).not.toHaveBeenCalled()
  })

  it('rejects a link when a different account owns the address', async () => {
    const currentMailbox = { ...mailbox, id: 'different-account' }
    select.mockReturnValue({
      from: () => ({ leftJoin: () => ({ where: () => ({ limit: () => [currentMailbox] }) }) }),
    })
    lock.mockResolvedValue([currentMailbox])

    for (const respond of [
      get,
      post,
      () => oneClick(new URLSearchParams({ 'List-Unsubscribe': 'One-Click' })),
    ]) {
      const response = await respond()
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'invalid-link' })
    }
    expect(write).not.toHaveBeenCalled()
  })
})
