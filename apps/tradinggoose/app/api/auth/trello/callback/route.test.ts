/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'http://localhost:3000',
}))

describe('Trello callback route', () => {
  it('renders the callback bridge page that posts tokens to the store route', async () => {
    const { GET } = await import('./route')
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/auth/trello/callback?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fworkspace%2Fws-1%2Fintegrations&state=trello-state'
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const body = await response.text()
    expect(body).toContain('/api/auth/trello/store')
    expect(body).toContain('trello_connected')
    expect(body).toContain('trello-state')
    expect(body).toContain('http://localhost:3000/workspace/ws-1/integrations')
  })

  it('escapes attacker-controlled state before embedding it in the script block', async () => {
    const { GET } = await import('./route')
    const injectedState = '</script><script>alert(1)</script>'
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/auth/trello/callback?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fworkspace%2Fws-1%2Fintegrations&state=${encodeURIComponent(injectedState)}`
      )
    )

    const body = await response.text()

    expect(body).not.toContain(injectedState)
    expect(body).toContain('\\u003C/script\\u003E\\u003Cscript\\u003Ealert(1)\\u003C/script\\u003E')
  })
})
