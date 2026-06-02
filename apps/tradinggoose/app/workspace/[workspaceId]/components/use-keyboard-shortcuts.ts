'use client'

import { useEffect, useMemo } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0
}

export function getKeyboardShortcutText(
  key: string,
  requiresCmd = false,
  requiresShift = false,
  requiresAlt = false
) {
  const isMac = isMacPlatform()
  const cmdKey = isMac ? '⌘' : 'Ctrl'
  const altKey = isMac ? '⌥' : 'Alt'
  const shiftKey = '⇧'

  const parts: string[] = []
  if (requiresCmd) parts.push(cmdKey)
  if (requiresShift) parts.push(shiftKey)
  if (requiresAlt) parts.push(altKey)
  parts.push(key)

  return parts.join('+')
}

export function useKeyboardShortcuts(onRunWorkflow: () => void, isDisabled = false) {
  const isMac = useMemo(() => isMacPlatform(), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && ((isMac && event.metaKey) || (!isMac && event.ctrlKey))) {
        const activeElement = document.activeElement
        const isEditableElement =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.hasAttribute('contenteditable')

        if (!isEditableElement && !isDisabled) {
          event.preventDefault()
          onRunWorkflow()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onRunWorkflow, isDisabled, isMac])
}

export function useGlobalShortcuts() {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const isMac = useMemo(() => isMacPlatform(), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isEditableElement =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')

      if (isEditableElement) return

      if (
        event.key.toLowerCase() === 'l' &&
        event.shiftKey &&
        ((isMac && event.metaKey) || (!isMac && event.ctrlKey))
      ) {
        event.preventDefault()

        const pathParts = pathname.split('/')
        const workspaceIndex = pathParts.indexOf('workspace')

        if (workspaceIndex !== -1 && pathParts[workspaceIndex + 1]) {
          const workspaceId = pathParts[workspaceIndex + 1]
          router.push(`/workspace/${workspaceId}/logs`)
        } else {
          router.push('/workspace')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pathname, router, isMac])
}
