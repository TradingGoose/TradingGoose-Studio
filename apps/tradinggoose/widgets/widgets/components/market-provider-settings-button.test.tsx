/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketProviderSettingsButton } from '@/widgets/widgets/components/market-provider-settings-button'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children, id }: { children?: ReactNode; id?: string }) => (
    <button type='button' id={id}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/env-var-dropdown', () => ({
  checkEnvVarTrigger: () => ({ show: false, searchTerm: '' }),
  EnvVarDropdown: () => null,
}))

describe('MarketProviderSettingsButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('saves raw credential values', async () => {
    const onSave = vi.fn()

    await act(async () => {
      root.render(
        <MarketProviderSettingsButton providerId='alpaca' providerName='Alpaca' onSave={onSave} />
      )
    })

    expect(container.textContent).toContain('Alpaca config')

    const apiKeyInput = container.querySelector(
      '#market-provider-param-alpaca-apiKey'
    ) as HTMLInputElement | null
    expect(apiKeyInput).toBeTruthy()

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(apiKeyInput, 'raw-key')
    await act(async () => {
      apiKeyInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save'
    )
    expect(saveButton).toBeTruthy()

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith({
      auth: {
        apiKey: 'raw-key',
      },
      providerParams: undefined,
    })
  })

  it('renders and resaves raw persisted credentials', async () => {
    const onSave = vi.fn()

    await act(async () => {
      root.render(
        <MarketProviderSettingsButton
          providerId='alpaca'
          providerName='Alpaca'
          authParams={{
            apiKey: 'raw-key',
            apiSecret: 'raw-secret',
          }}
          onSave={onSave}
        />
      )
    })

    const apiKeyInput = container.querySelector(
      '#market-provider-param-alpaca-apiKey'
    ) as HTMLInputElement | null
    const apiSecretInput = container.querySelector(
      '#market-provider-param-alpaca-apiSecret'
    ) as HTMLInputElement | null

    expect(apiKeyInput?.value).toBe('raw-key')
    expect(apiSecretInput?.value).toBe('raw-secret')

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save'
    )

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith({
      auth: {
        apiKey: 'raw-key',
        apiSecret: 'raw-secret',
      },
      providerParams: undefined,
    })
  })

  it('clears an existing env credential when the input is emptied', async () => {
    const onSave = vi.fn()

    await act(async () => {
      root.render(
        <MarketProviderSettingsButton
          providerId='alpaca'
          providerName='Alpaca'
          authParams={{
            apiKey: '{{ ALPACA_API_KEY }}',
          }}
          onSave={onSave}
        />
      )
    })

    const apiKeyInput = container.querySelector(
      '#market-provider-param-alpaca-apiKey'
    ) as HTMLInputElement | null
    expect(apiKeyInput?.value).toBe('{{ ALPACA_API_KEY }}')

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(apiKeyInput, '')
    await act(async () => {
      apiKeyInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Save'
    )
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith({
      auth: undefined,
      providerParams: undefined,
    })
  })
})
