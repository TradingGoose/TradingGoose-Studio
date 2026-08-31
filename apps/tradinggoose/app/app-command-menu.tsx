'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, House, LayoutDashboard, LogIn, MoonStar, Newspaper } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { useTheme } from 'next-themes'
import { Toaster, toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { useSession } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'
import { formatTemplate, type LocaleCode, localizeDocsUrl } from '@/i18n/utils'
import { useGeneralStore } from '@/stores/settings/general/store'

export function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === 'dark' || resolvedTheme === 'light' ? resolvedTheme : 'system'

  return <Toaster position='bottom-right' theme={theme} richColors closeButton />
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  )
}

export function AppCommandMenu() {
  const [open, setOpen] = useState(false)
  const copy = useMessages()
  const locale = useLocale() as LocaleCode
  const router = useRouter()
  const { data: session } = useSession()
  const { resolvedTheme, setTheme } = useTheme()
  const persistTheme = useGeneralStore((state) => state.setTheme)
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const nextThemeLabel = copy.workspace.userMenu.themeOptions[nextTheme]

  const toggleTheme = useCallback(async () => {
    if (isThemeLoading) {
      return
    }

    setTheme(nextTheme)

    try {
      if (session?.user?.id) {
        await persistTheme(nextTheme)
      }
      toast.success(
        formatTemplate(copy.nav.commandMenu.themeChanged, {
          theme: nextThemeLabel,
        })
      )
    } catch {
      toast.error(copy.nav.commandMenu.themeChangeFailed)
    }
  }, [
    copy.nav.commandMenu.themeChangeFailed,
    copy.nav.commandMenu.themeChanged,
    isThemeLoading,
    nextTheme,
    nextThemeLabel,
    persistTheme,
    session?.user?.id,
    setTheme,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((currentOpen) => !currentOpen)
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'd'
      ) {
        event.preventDefault()
        void toggleTheme()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [toggleTheme])

  const sessionDestination = useMemo(
    () =>
      session?.user?.id
        ? {
            href: '/workspace' as const,
            icon: LayoutDashboard,
            label: copy.nav.goToDashboard,
          }
        : {
            href: '/login' as const,
            icon: LogIn,
            label: copy.nav.login,
          },
    [copy.nav.goToDashboard, copy.nav.login, session?.user?.id]
  )

  const navigate = (href: '/' | '/blog' | '/workspace' | '/login') => {
    setOpen(false)
    router.push(href)
  }

  const openDocs = () => {
    setOpen(false)
    window.location.assign(localizeDocsUrl(locale))
  }

  const selectTheme = () => {
    setOpen(false)
    void toggleTheme()
  }

  const SessionIcon = sessionDestination.icon

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={copy.nav.commandMenu.title}>
      <CommandInput placeholder={copy.nav.commandMenu.searchPlaceholder} />
      <CommandList>
        <CommandEmpty>{copy.nav.commandMenu.empty}</CommandEmpty>
        <CommandGroup heading={copy.nav.commandMenu.navigation}>
          <CommandItem value={copy.nav.homeLabel} onSelect={() => navigate('/')}>
            <House aria-hidden='true' />
            {copy.nav.homeLabel}
          </CommandItem>
          <CommandItem value={copy.nav.docs} onSelect={openDocs}>
            <BookOpen aria-hidden='true' />
            {copy.nav.docs}
          </CommandItem>
          <CommandItem value={copy.nav.blog} onSelect={() => navigate('/blog')}>
            <Newspaper aria-hidden='true' />
            {copy.nav.blog}
          </CommandItem>
          <CommandItem
            value={sessionDestination.label}
            onSelect={() => navigate(sessionDestination.href)}
          >
            <SessionIcon aria-hidden='true' />
            {sessionDestination.label}
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={copy.nav.commandMenu.actions}>
          <CommandItem value={copy.nav.commandMenu.toggleTheme} onSelect={selectTheme}>
            <MoonStar aria-hidden='true' />
            {copy.nav.commandMenu.toggleTheme}
            <CommandShortcut>⇧D</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
