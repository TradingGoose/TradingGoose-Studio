import { afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import enMessages from './i18n/messages/en.json'
import type { LocaleCode } from './i18n/utils'

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
) as any

// Mock localStorage and sessionStorage for Zustand persist middleware
const storageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

global.localStorage = storageMock as any
global.sessionStorage = storageMock as any

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl')
  const React = await import('react')
  const LocaleContext = React.createContext<LocaleCode>('en')
  const MessagesContext = React.createContext(enMessages)

  const resolveMessage = (messages: Record<string, unknown>, key: string) =>
    key.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined
      }
      return (current as Record<string, unknown>)[segment]
    }, messages)

  const formatMessage = (
    locale: LocaleCode,
    template: string,
    values?: Record<string, string | number | boolean | null | undefined>
  ) => {
    let formatError: unknown
    const translator = actual.createTranslator({
      locale,
      messages: { value: template },
      onError(error) {
        formatError = error
      },
    })
    const formatted = translator('value', values as Record<string, string | number | Date>)

    if (formatError) {
      throw formatError
    }

    return formatted
  }

  return {
    ...actual,
    NextIntlClientProvider: ({ children, locale, messages }: any) =>
      React.createElement(
        LocaleContext.Provider,
        { value: locale ?? 'en' },
        React.createElement(MessagesContext.Provider, { value: messages ?? enMessages }, children)
      ),
    useLocale: () => React.useContext(LocaleContext),
    useMessages: () => React.useContext(MessagesContext),
    useTranslations: (namespace?: string) => {
      const messages = React.useContext(MessagesContext)
      const locale = React.useContext(LocaleContext)

      return (
        key: string,
        values?: Record<string, string | number | boolean | null | undefined>
      ) => {
        const fullKey = namespace ? `${namespace}.${key}` : key
        const resolved = resolveMessage(messages, fullKey)

        if (typeof resolved !== 'string') {
          return fullKey
        }

        return formatMessage(locale, resolved, values)
      }
    },
  }
})

vi.mock('@/lib/logs/console/logger', () => {
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }))

  return { createLogger }
})

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
    }),
  },
}))

vi.mock('@/blocks/registry', () => {
  const fallbackBlock = {
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    category: 'blocks',
    subBlocks: [],
    outputs: {},
  }

  const registry = {
    agent: {
      ...fallbackBlock,
      name: 'Mock Agent',
      subBlocks: [
        {
          id: 'responseFormat',
          type: 'code',
          language: 'json',
          generationType: 'json-schema',
        },
      ],
    },
    condition: {
      ...fallbackBlock,
      name: 'Mock Condition',
      subBlocks: [
        {
          id: 'conditions',
          type: 'condition-input',
        },
      ],
    },
    function: {
      ...fallbackBlock,
      name: 'Mock Function',
      longDescription:
        'Execute custom TypeScript code. Indicator execution is available through indicator.<ID>(marketSeries) using Historical Data block output.',
      subBlocks: [
        {
          id: 'code',
          type: 'code',
          language: 'typescript',
          generationType: 'typescript-function-body',
        },
      ],
    },
    historical_data: {
      ...fallbackBlock,
      name: 'Mock Historical Data',
      longDescription:
        'Fetch series bars that include open, high, low, close, volume, and timestamps.',
    },
    generic_webhook: { ...fallbackBlock, name: 'Mock Webhook', category: 'triggers' },
  }

  const getBlock = vi.fn((type: string) => {
    const candidate = (registry as Record<string, any>)[type]
    if (candidate) {
      return candidate
    }

    return { ...fallbackBlock, name: `Mock ${type}` }
  })

  const getAllBlocks = vi.fn(() => Object.values(registry))
  const getBlocksByCategory = vi.fn((category: string) =>
    Object.values(registry).filter((block) => block.category === category)
  )
  const getAllBlockTypes = vi.fn(() => Object.keys(registry))
  const isValidBlockType = vi.fn((type: string) => Object.hasOwn(registry, type))

  return {
    registry,
    getBlock,
    getAllBlocks,
    getBlocksByCategory,
    getAllBlockTypes,
    isValidBlockType,
  }
})

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: any[]) => {
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleError(...args)
}

console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleWarn(...args)
}

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
