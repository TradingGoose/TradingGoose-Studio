/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { CopilotWelcome } from './welcome'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('CopilotWelcome i18n', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders localized limited-access welcome copy', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <CopilotWelcome accessLevel='limited' />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain('Revisar cambios con seguridad')
    expect(container.textContent).toContain('Shift+Enter para nueva línea')
  })

  it('renders localized full-access welcome copy', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='zh' messages={getPublicCopy('zh')}>
          <CopilotWelcome accessLevel='full' />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain('构建和编辑工作流')
    expect(container.textContent).toContain('提问并允许工具无需额外批准直接执行')
  })
})
