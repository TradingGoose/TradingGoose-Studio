import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SidebarNav } from './sidebar-nav'

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'zh-CN'),
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: { children: ReactNode }) => createElement('section', null, children),
  SidebarGroupLabel: ({ children }: { children: ReactNode }) => createElement('h2', null, children),
  SidebarMenu: ({ children }: { children: ReactNode }) => createElement('ul', null, children),
  SidebarMenuButton: ({ children }: { children: ReactNode }) => createElement('li', null, children),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}))

describe('SidebarNav', () => {
  it('prefixes links with the active locale', () => {
    useLocaleMock.mockReturnValue('zh-CN')

    const markup = renderToStaticMarkup(
      createElement(SidebarNav, {
        navItems: [
          {
            title: 'Dashboard',
            url: '/workspace/ws-1/dashboard',
            section: 'workspace',
            icon: (() => createElement('svg')) as any,
            isActive: true,
          },
        ],
      })
    )

    expect(markup).toContain('href="/zh/workspace/ws-1/dashboard"')
    expect(markup).toContain('工作区')
  })
})
