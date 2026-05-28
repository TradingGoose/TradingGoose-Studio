/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPublicCopy, getScopedPublicMessages } from './public-copy'
import { useAppMessages, useAuthMessages } from './client-messages'
import { useWorkflowInspectorMessages } from './workspace-widget-hooks'

function AuthMessageProbe() {
  const authCopy = useAuthMessages()
  return <div data-testid='auth-message'>{authCopy.common.signIn}</div>
}

function AppMessageProbe() {
  const copy = useAppMessages()
  return (
    <div data-testid='app-message'>
      {copy.nav.docs} | {copy.registration.open.primary}
    </div>
  )
}

function WorkflowInspectorProbe() {
  const inspectorCopy = useWorkflowInspectorMessages()
  return <div data-testid='workflow-message'>{inspectorCopy.workflowEditor.previewInspector}</div>
}

describe('client messages hooks', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

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

  it('reads public auth copy from the provider-backed app hook', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='es' messages={getPublicCopy('es')}>
          <AuthMessageProbe />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(getPublicCopy('es').auth.common.signIn)
  })

  it('reads scoped nav and registration copy from the provider-backed app hook', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale='en'
          messages={getScopedPublicMessages('en', ['nav', 'registration'] as const)}
        >
          <AppMessageProbe />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(getPublicCopy('en').nav.docs)
    expect(container.textContent).toContain(getPublicCopy('en').registration.open.primary)
  })

  it('reads workflow inspector copy from the workspace widget hook', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='zh-CN' messages={getPublicCopy('zh-CN')}>
          <WorkflowInspectorProbe />
        </NextIntlClientProvider>
      )
    })

    expect(container.textContent).toContain(
      getPublicCopy('zh-CN').workspace.widgets.workflowInspector.workflowEditor.previewInspector
    )
  })
})
