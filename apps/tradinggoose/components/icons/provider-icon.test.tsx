/** @vitest-environment jsdom */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getProviderIcon } from '@/lib/ui/provider-icon'
import { ProviderIcon } from './provider-icon'

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
const fetchMock = vi.fn()
let theme = 'light'
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: theme }) }))
const coloredLogo = {
  src: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/light/deepseek-color.webp',
  darkSrc: 'https://cdn.jsdelivr.net/npm/@lobehub/icons-static-webp@2.6.0/dark/deepseek-color.webp',
  monochrome: false,
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  theme = 'light'
  vi.stubGlobal('fetch', fetchMock.mockReset())
  queryClient = new QueryClient()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  vi.unstubAllGlobals()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
})

async function render(children: React.ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

it('shares one metadata request and keeps colors while unmatched icons stay monochrome', async () => {
  fetchMock.mockResolvedValue(Response.json({ deepseek: coloredLogo }))
  const DeepSeekIcon = getProviderIcon('deepseek')
  await render(
    <>
      <DeepSeekIcon className='h-3 w-3' />
      <ProviderIcon provider='deepseek' />
      <ProviderIcon provider='frogbot' />
    </>
  )
  await vi.waitFor(() =>
    expect(container.querySelector('img')).toHaveAttribute('src', coloredLogo.src)
  )
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/models/icons')
  const images = container.querySelectorAll('img')
  expect(images[0]).toHaveClass('h-3', 'w-3')
  expect(images[0]).not.toHaveClass('dark:invert')
  expect(images[1]).toHaveAttribute('src', coloredLogo.src)
  expect(images[2]).toHaveAttribute('src', 'https://models.dev/logos/frogbot.svg')
  expect(images[2]).toHaveClass('dark:invert')
  theme = 'dark'
  await render(
    <>
      <DeepSeekIcon className='h-3 w-3' />
      <ProviderIcon provider='deepseek' />
      <ProviderIcon provider='frogbot' />
    </>
  )
  expect(images[0]).toHaveAttribute('src', coloredLogo.darkSrc)
  expect(images[0]).not.toHaveClass('dark:invert')
  expect(images[2]).toHaveAttribute('src', 'https://models.dev/logos/frogbot.svg')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('keeps the exact models.dev icon when the metadata service is unavailable', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 503 }))
  await render(<ProviderIcon provider='new-provider' />)
  await vi.waitFor(() =>
    expect(queryClient.getQueryState(['provider-icons'])?.status).toBe('error')
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    'https://models.dev/logos/new-provider.svg'
  )
})

it('falls back once on an asset failure and does not carry it into another provider', async () => {
  queryClient.setQueryData(['provider-icons'], { deepseek: coloredLogo })
  await render(<ProviderIcon provider='deepseek' />)
  act(() => container.querySelector('img')!.dispatchEvent(new Event('error')))
  const image = container.querySelector('img')!
  expect(image).toHaveAttribute('src', 'https://models.dev/logos/deepseek.svg')
  expect(image).toHaveClass('dark:invert')
  act(() => image.dispatchEvent(new Event('error')))
  expect(image).toHaveAttribute('src', 'https://models.dev/logos/deepseek.svg')
  await render(<ProviderIcon provider='anthropic' />)
  expect(container.querySelector('img')).toHaveAttribute(
    'src',
    'https://models.dev/logos/anthropic.svg'
  )
  expect(fetchMock).not.toHaveBeenCalled()
})
