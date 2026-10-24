/** @vitest-environment jsdom */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResponseBlockHandler } from '@/executor/handlers/response/response-handler'
import { getPublicCopy } from '@/i18n/public-copy'
import type { SerializedBlock } from '@/serializer/types'
import { type ResponseField, ResponseFormat } from './input-format'

const saved = vi.hoisted(() => ({ fields: [] as ResponseField[] }))
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value',
  async () => {
    const { useState } = await import('react')
    return {
      useSubBlockValue: () => {
        const state = useState<ResponseField[]>([])
        saved.fields = state[0]
        return state
      },
    }
  }
)

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  TagDropdown: () => null,
  checkTagTrigger: () => ({ show: false }),
}))

vi.mock(
  '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/listing-selector/listing-selector',
  () => ({ ListingSelectorInput: () => null })
)

describe('ResponseFormat Builder literals', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <ResponseFormat blockId='response' subBlockId='builderData' />
        </NextIntlClientProvider>
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  async function click(element: HTMLElement) {
    await act(async () => element.click())
  }

  function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    act(() => {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it.each([
    ['Number', '42', 42],
    ['Boolean', 'False', false],
    ['Object', '{"x":1}', { x: 1 }],
    ['Array', '[1,2]', [1, 2]],
    ['String', '42', '42'],
  ])(
    'creates and executes a %s literal through the Builder controls',
    async (type, value, expected) => {
      await click(container.querySelector('button')!)
      expect(saved.fields).toMatchObject([{ name: '', type: 'string', value: '' }])
      enter(container.querySelector('input[name="name"]')!, 'result')
      const typeTrigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
      expect(typeTrigger).not.toBeNull()
      await click(typeTrigger!)
      await click(
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
          item.textContent?.endsWith(String(type))
        )!
      )
      if (type === 'Boolean') {
        await click(container.querySelector('[role="combobox"]')!)
        const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
          (item) => item.textContent === value
        )!
        await act(async () => {
          option.focus()
          option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
      } else {
        enter(
          container.querySelector('input[name="value"], textarea[name="value"]')!,
          String(value)
        )
      }

      const block: SerializedBlock = {
        id: 'response',
        metadata: { id: 'response' },
        position: { x: 0, y: 0 },
        config: { tool: 'response', params: {} },
        inputs: {},
        outputs: {},
        enabled: true,
      }
      for (const inputs of [
        { builderData: saved.fields },
        {
          dataMode: 'json',
          data: ResponseBlockHandler.convertBuilderDataToJsonString(
            saved.fields as Parameters<
              typeof ResponseBlockHandler.convertBuilderDataToJsonString
            >[0]
          ),
        },
      ]) {
        const { response } = await new ResponseBlockHandler().execute(block, inputs)
        expect(response.status).toBe(200)
        expect(response.data).toStrictEqual({ result: expected })
      }
    }
  )
})
