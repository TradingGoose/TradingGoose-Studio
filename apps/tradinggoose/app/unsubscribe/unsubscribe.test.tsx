// @vitest-environment jsdom
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import messages from '@/i18n/messages/en.json'
import Unsubscribe from './unsubscribe'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams({ email: 'user@example.com', token: 'signed' }),
}))

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['marketing', 'unsubscribeMarketing', 'marketingButton', 'marketingUnsubscribed'],
  ['all', 'unsubscribeAll', 'allButton', 'allButtonUnsubscribed'],
] as const)(
  'can retry the %s opt-out immediately and after reload',
  async (type, flag, first, saved) => {
    const copy = messages.unsubscribe
    const mailbox = { email: 'user@example.com', token: 'signed' }
    let stored = false
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options) {
        return Response.json({
          success: true,
          email: mailbox.email,
          currentPreferences: { [flag]: stored },
        })
      }
      stored = true
      return Response.json({ error: 'email_preference_sync_failed' }, { status: 503 })
    })
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)
    const open = (key: number) =>
      act(async () =>
        root.render(
          <NextIntlClientProvider key={key} locale='en' messages={messages}>
            <Unsubscribe />
          </NextIntlClientProvider>
        )
      )
    const click = async (name: string) => {
      const button = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === name
      )
      expect(button).toBeEnabled()
      await act(async () => button!.click())
    }
    try {
      await open(1)
      await click(copy.main[first])
      expect(container.querySelector('[role="alert"]')).toHaveTextContent(
        copy.errors['failed-processing']
      )
      await click(copy.main[first])
      await open(2)
      fetch.mockResolvedValueOnce(Response.json({ success: true }))
      await click(copy.main[saved])
      expect(container).toHaveTextContent(copy.success.title)
      const posted = fetch.mock.calls.flatMap(([, options]) =>
        options?.method === 'POST' ? [JSON.parse(String(options.body))] : []
      )
      expect(posted).toEqual(Array(3).fill({ ...mailbox, type }))
    } finally {
      await act(async () => root.unmount())
    }
  }
)
