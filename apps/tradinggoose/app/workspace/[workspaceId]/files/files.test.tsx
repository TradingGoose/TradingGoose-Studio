/** @vitest-environment jsdom */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocaleCode } from '@/i18n/utils'

const mockUseWorkspaceFilesManager = vi.fn()
const mockUseUserPermissionsContext = vi.fn()
let mockWorkspaceId = 'ws-1'
const intlState = vi.hoisted(() => ({
  locale: 'en',
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: mockWorkspaceId }),
}))

vi.mock('next/navigation.js', () => ({
  useParams: () => ({ workspaceId: mockWorkspaceId }),
}))

vi.mock('next-intl', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  const { getPublicCopy } = await import('@/i18n/public-copy')

  function resolveNestedMessage(source: unknown, path: string) {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object' && segment in current) {
        return (current as Record<string, unknown>)[segment]
      }

      return undefined
    }, source)
  }

  return {
    useLocale: () => intlState.locale,
    useTranslations: (namespace: string) => {
      return (key: string, values?: Record<string, string | number>) => {
        const messages = getPublicCopy(intlState.locale)
        const template = resolveNestedMessage(messages, `${namespace}.${key}`)

        if (typeof template !== 'string') {
          throw new Error(`Missing translation for ${namespace}.${key}`)
        }

        if (!values) {
          return template
        }

        return createTranslator({
          locale: intlState.locale as LocaleCode,
          messages: { value: template },
        })('value', values)
      }
    },
  }
})

vi.mock('@/app/workspace/[workspaceId]/files/hooks/use-workspace-files', () => ({
  ACCEPT_ATTR: '.pdf',
  useWorkspaceFilesManager: (...args: unknown[]) => mockUseWorkspaceFilesManager(...args),
}))

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => mockUseUserPermissionsContext(),
}))

vi.mock('@/components/ui', () => ({
  Alert: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  AlertDialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Progress: ({ value }: { value?: number }) => <div data-progress={value ?? 0} />,
  Skeleton: () => <div data-testid='skeleton' />,
}))

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({
    left,
    right,
  }: {
    left?: React.ReactNode
    right?: React.ReactNode
  }) => (
    <div data-testid='global-navbar-header'>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  ),
}))

vi.mock('@/app/workspace/[workspaceId]/knowledge/components', () => ({
  getDocumentIcon: () => () => null,
}))

async function renderWorkspaceFiles(root: Root, locale: LocaleCode) {
  intlState.locale = locale
  const { WorkspaceFiles } = await import('./files')
  root.render(<WorkspaceFiles />)
}

describe('WorkspaceFiles table headers', () => {
  let container: HTMLDivElement
  let root: Root

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceId = 'ws-1'
    mockUseWorkspaceFilesManager.mockReturnValue({
      files: [],
      loading: false,
      uploading: false,
      deletingFileId: null,
      uploadError: null,
      uploadProgress: { completed: 0, total: 0 },
      storageInfo: null,
      storageLoading: false,
      tierDisplayName: 'Starter',
      isPaidTier: false,
      uploadFiles: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
    })
    mockUseUserPermissionsContext.mockReturnValue({
      canEdit: false,
    })

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

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('renders the files table headers in Chinese when zh is active', async () => {
    await act(async () => {
      await renderWorkspaceFiles(root, 'zh')
    })

    const headerRowText = container.querySelector('thead')?.textContent ?? ''

    expect(headerRowText).toContain('名称')
    expect(headerRowText).toContain('大小')
    expect(headerRowText).toContain('上传时间')
    expect(headerRowText).toContain('操作')
    expect(headerRowText).not.toContain('Name')
    expect(headerRowText).not.toContain('Size')
    expect(headerRowText).not.toContain('Uploaded')
    expect(headerRowText).not.toContain('Actions')
  })

  it('renders the files table headers in English for the default locale', async () => {
    await act(async () => {
      await renderWorkspaceFiles(root, 'en')
    })

    const headerRowText = container.querySelector('thead')?.textContent ?? ''

    expect(headerRowText).toContain('Name')
    expect(headerRowText).toContain('Size')
    expect(headerRowText).toContain('Uploaded')
    expect(headerRowText).toContain('Actions')
  })
})
