/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { getClientMessages } from '@/i18n/public-copy'
import { UsageLimit } from './usage-limit'

vi.unmock('next-intl')

describe('exact usage limit edits', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  const request = vi.fn()
  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    request.mockReset().mockResolvedValue(new Response(JSON.stringify({ success: true })))
    vi.stubGlobal('fetch', request)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    vi.unstubAllGlobals()
  })
  async function render(
    context: 'user' | 'organization' = 'user',
    currentUsage: string | null = '0.30000000000000001'
  ) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale='en' messages={getClientMessages('en')}>
            <UsageLimit
              currentLimit='0.30000000000000001'
              currentUsage={currentUsage}
              minimumLimit='0'
              canEdit
              context={context}
              organizationId={context === 'organization' ? 'organization' : undefined}
            />
          </NextIntlClientProvider>
        </QueryClientProvider>
      )
    )
  }
  async function change(value: string) {
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector('button')!.click())
  }

  it('refuses a limit below exact current usage instead of rounding both to equality', async () => {
    await render()
    await act(async () => container.querySelector('button')!.click())
    await change('0.3')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(container.querySelector('input')?.value).toBe('0.3')
  })

  it.each(['user', 'organization'] as const)(
    'preserves decimal text through %s HTTP edits and does not rewrite cached money',
    async (context) => {
      queryClient.setQueryData(subscriptionKeys.user(), {
        data: { usage: { current: '0.30000000000000001', limit: '0.30000000000000001' } },
      })
      await render(context)
      await act(async () => container.querySelector('button')!.click())
      expect(container.querySelector('input')?.value).toBe('0.30000000000000001')
      await change('0.30000000000000002')
      expect(request).toHaveBeenCalledTimes(1)
      const body = JSON.parse(request.mock.calls[0][1].body)
      expect(body.limit).toBe('0.30000000000000002')
      if (context === 'organization')
        expect(body).toMatchObject({ context, organizationId: 'organization' })
      expect(queryClient.getQueryData(subscriptionKeys.user())).toMatchObject({
        data: { usage: { current: '0.30000000000000001', limit: '0.30000000000000001' } },
      })
    }
  )

  it('keeps editing unavailable while current monetary usage is unknown', async () => {
    await render('user', null)
    expect(container.querySelector('button')).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
