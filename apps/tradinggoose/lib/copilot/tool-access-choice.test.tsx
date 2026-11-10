/** @vitest-environment jsdom */
import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getPublicCopy } from '@/i18n/public-copy'
import type { AppLocale } from '@/i18n/routing'
import type { CopilotToolCall } from '@/stores/copilot/types'
import { ToolAccessChoice } from './tool-access-choice'

const seams = vi.hoisted(() => ({
  authorize: vi.fn(),
  readback: vi.fn(),
  selector: vi.fn(),
  execute: vi.fn(),
}))
vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: () => ({
    authorizeToolWorkspace: seams.authorize,
    readbackCopilotToolCall: seams.readback,
    executeCopilotToolCall: seams.execute,
  }),
}))
vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector',
  () => ({
    ToolCredentialSelector: (props: {
      workspaceId: string
      beforeSelect: () => Promise<void>
      onChange: (value: string) => Promise<void>
    }) => {
      seams.selector(props)
      return (
        <button
          onClick={async () => {
            try {
              await props.beforeSelect()
              await props.onChange('explicit-credential')
            } catch {}
          }}
        >
          Choose credential in {props.workspaceId}
        </button>
      )
    },
  })
)
let root: Root
let container: HTMLDivElement
const call: CopilotToolCall = {
  id: 'original-call',
  name: 'gdrive_request_access',
  state: ClientToolCallState.pending,
  params: {},
}
const oauth = (): CopilotToolCall => ({ ...call, name: 'oauth_request_access' })
const render = async (value = call, locale: AppLocale = 'en') =>
  act(async () =>
    root.render(
      <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
        <ToolAccessChoice toolCall={value} />
      </NextIntlClientProvider>
    )
  )
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  seams.authorize.mockImplementation(async (_id: string, workspace?: string) => {
    if (!workspace) throw new Error('Missing explicit workspace')
    return workspace
  })
  seams.readback.mockResolvedValue(undefined)
  seams.execute.mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        workspaces: [
          { id: 'business-a', name: 'Business A' },
          { id: 'business-b', name: 'Business B' },
        ],
      })
    )
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})
it('makes no default-first choice and mounts credentials only with explicit authorized workspace', async () => {
  await render()
  const select = container.querySelector('select')!
  expect(select.value).toBe('')
  expect(seams.authorize).not.toHaveBeenCalled()
  expect(seams.selector).not.toHaveBeenCalled()
  await act(async () => {
    select.value = 'business-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(seams.authorize).toHaveBeenCalledWith('original-call', 'business-b')
  expect(seams.selector.mock.lastCall?.[0].workspaceId).toBe('business-b')
  await act(async () => container.querySelector('button')!.click())
  expect(seams.readback).toHaveBeenCalledExactlyOnceWith('original-call', {
    credentialId: 'explicit-credential',
  })
  expect(call.params).toEqual({})
})
it('keeps an honest denied choice and no credentials when authorization fails', async () => {
  seams.authorize.mockRejectedValue(new Error('Workspace access denied'))
  await render()
  await act(async () => {
    const select = container.querySelector('select')!
    select.value = 'business-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Workspace access denied')
  expect(seams.selector).not.toHaveBeenCalled()
  expect(seams.readback).not.toHaveBeenCalled()
})
it('retains genuine original workspace rather than offering a replacement default', async () => {
  seams.authorize.mockResolvedValue('business-a')
  await render({ ...call, provenance: { workspaceId: 'business-a' } })
  expect(seams.authorize).toHaveBeenCalledExactlyOnceWith('original-call')
  expect(container.querySelector('select')!.disabled).toBe(true)
  expect(seams.selector.mock.lastCall?.[0].workspaceId).toBe('business-a')
})
it('refuses a retained callback after unmount before readback', async () => {
  await render()
  await act(async () => {
    const select = container.querySelector('select')!
    select.value = 'business-a'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const props = seams.selector.mock.lastCall![0]
  act(() => root.render(<div>New turn</div>))
  await expect(props.beforeSelect()).rejects.toThrow('no longer selected')
  await props.onChange('credential')
  expect(seams.readback).not.toHaveBeenCalled()
})

it.each(['en', 'es', 'zh'] as const)(
  'requires a localized new OAuth workspace choice and separate Connect action in %s',
  async (locale) => {
    const value = oauth()
    const copy = getPublicCopy(locale).workspace.widgets.copilot.driveChoice
    await render(value, locale)
    expect(container.textContent).toContain(copy.oauthTitle)
    expect(container.textContent).toContain(copy.oauthNewChoice)
    expect(container.textContent).not.toContain(copy.original)
    expect(container.querySelector('select')!.value).toBe('')
    expect(container.querySelector('button')).toBeNull()
    expect(seams.authorize).not.toHaveBeenCalled()
    expect(seams.selector).not.toHaveBeenCalled()
    expect(seams.execute).not.toHaveBeenCalled()
    await act(async () => {
      const select = container.querySelector('select')!
      select.value = 'business-b'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(seams.authorize).toHaveBeenCalledExactlyOnceWith('original-call', 'business-b')
    expect(seams.execute).not.toHaveBeenCalled()
    expect(seams.selector).not.toHaveBeenCalled()
    expect(seams.readback).not.toHaveBeenCalled()
    expect(container.querySelector('button')?.textContent).toBe(copy.connect)
    // The store may project this local choice back into the same card; it is still NEW.
    await render({ ...value, provenance: { workspaceId: 'business-b' } }, locale)
    expect(container.textContent).toContain(copy.oauthNewChoice)
    expect(container.textContent).not.toContain(copy.original)
    await act(async () => container.querySelector('button')!.click())
    expect(seams.authorize).toHaveBeenNthCalledWith(2, 'original-call', 'business-b')
    expect(seams.execute).toHaveBeenCalledExactlyOnceWith('original-call')
    expect(seams.readback).not.toHaveBeenCalled()
    expect(seams.selector).not.toHaveBeenCalled()
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(['/api/workspaces'])
    expect(value.params).toEqual({})
    expect(value.provenance).toBeUndefined()
  }
)

it('freshly authorizes genuine initial OAuth context without changing it or connecting automatically', async () => {
  seams.authorize.mockResolvedValue('business-a')
  await render({ ...oauth(), provenance: { workspaceId: 'business-a' } })
  const copy = getPublicCopy('en').workspace.widgets.copilot.driveChoice
  expect(seams.authorize).toHaveBeenCalledExactlyOnceWith('original-call')
  expect(container.textContent).toContain(copy.original)
  expect(container.textContent).not.toContain(copy.oauthNewChoice)
  expect(container.querySelector('select')!.value).toBe('business-a')
  expect(container.querySelector('select')!.disabled).toBe(true)
  expect(container.querySelector('button')?.textContent).toBe(copy.connect)
  expect(seams.selector).not.toHaveBeenCalled()
  expect(seams.execute).not.toHaveBeenCalled()
  await act(async () => container.querySelector('button')!.click())
  expect(seams.authorize).toHaveBeenNthCalledWith(2, 'original-call', 'business-a')
  expect(seams.execute).toHaveBeenCalledExactlyOnceWith('original-call')
})

it('keeps a denied OAuth choice actionable without Connect, credential or effect contact', async () => {
  seams.authorize.mockRejectedValue(new Error('Workspace access denied'))
  await render(oauth())
  await act(async () => {
    const select = container.querySelector('select')!
    select.value = 'business-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Workspace access denied')
  expect(container.querySelector('button')).toBeNull()
  expect(seams.execute).not.toHaveBeenCalled()
  expect(seams.selector).not.toHaveBeenCalled()
  expect(seams.readback).not.toHaveBeenCalled()
})

it('refuses OAuth Connect when fresh workspace authorization is revoked', async () => {
  await render(oauth())
  await act(async () => {
    const select = container.querySelector('select')!
    select.value = 'business-a'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  seams.authorize.mockRejectedValue(new Error('Workspace access was revoked'))
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Workspace access was revoked'
  )
  expect(seams.execute).not.toHaveBeenCalled()
  expect(seams.readback).not.toHaveBeenCalled()
})

it.each(['choice', 'connect'] as const)(
  'refuses a delayed OAuth %s after the card unmounts',
  async (stage) => {
    await render(oauth())
    if (stage === 'connect') {
      await act(async () => {
        const select = container.querySelector('select')!
        select.value = 'business-a'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    let authorize!: (workspace: string) => void
    seams.authorize.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        authorize = resolve
      })
    )
    await act(async () => {
      if (stage === 'choice') {
        const select = container.querySelector('select')!
        select.value = 'business-a'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      } else container.querySelector('button')!.click()
    })
    act(() => root.render(<div>Another tool</div>))
    await act(async () => authorize('business-a'))
    expect(container.textContent).toBe('Another tool')
    expect(seams.execute).not.toHaveBeenCalled()
    expect(seams.readback).not.toHaveBeenCalled()
  }
)

it.each(['malformed', 'duplicate'] as const)(
  'refuses a %s OAuth workspace list without choosing or contacting an effect',
  async (kind) => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        workspaces:
          kind === 'duplicate'
            ? [
                { id: 'business-a', name: 'A' },
                { id: 'business-a', name: 'Again' },
              ]
            : [{ id: '', name: 'Unknown' }],
      })
    )
    await render(oauth())
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(seams.authorize).not.toHaveBeenCalled()
    expect(seams.execute).not.toHaveBeenCalled()
    expect(seams.selector).not.toHaveBeenCalled()
  }
)
