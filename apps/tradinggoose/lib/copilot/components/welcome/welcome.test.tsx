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

  it.each([
    ['es', 'limited', ['Revisar cambios con seguridad', 'Shift+Enter para nueva línea']],
    ['zh', 'full', ['构建和编辑工作流', '提问并允许工具无需额外批准直接执行']],
  ] as const)('renders %s %s-access welcome copy', async (locale, accessLevel, expected) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <CopilotWelcome accessLevel={accessLevel} />
        </NextIntlClientProvider>
      )
    })

    for (const copy of expected) expect(container.textContent).toContain(copy)
  })
})
