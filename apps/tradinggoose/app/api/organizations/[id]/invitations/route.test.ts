import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'

const select = vi.hoisted(() => vi.fn())

vi.mock('@tradinggoose/db', () => ({ db: { select } }))
vi.mock('@/lib/auth', () => ({
  getSession: async () => ({ user: { id: 'owner' } }),
}))

import { POST } from './route'

it('rejects an obsolete dry-run request before starting an invitation', async () => {
  const request = new NextRequest(
    'http://localhost/api/organizations/org-1/invitations?validate=true',
    { method: 'POST', body: JSON.stringify({ email: 'member@example.com' }) }
  )

  const response = await POST(request, { params: Promise.resolve({ id: 'org-1' }) })

  expect(response.status).toBe(400)
  expect(select).not.toHaveBeenCalled()
})
