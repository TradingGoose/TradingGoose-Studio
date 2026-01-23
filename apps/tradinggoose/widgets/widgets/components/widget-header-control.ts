'use client'

import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const BASE_CONTROL_CLASS =
  'inline-flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-background px-2 p-1 text-xs font-medium text-foreground transition-colors hover:bg-card  disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-border hover:shadwow-sm'
const ICON_BUTTON_CLASS = cn(
  BASE_CONTROL_CLASS,
  'h-7 w-7 shrink-0 justify-center shadow-xs text-muted-foreground hover:text-foreground'
)

const MENU_TIMERS = {
  CLOSE_DELAY: 600,
} as const

export const widgetHeaderMenuContentClassName = cn(
  'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  'z-50 animate-in overflow-hidden rounded-sm border bg-background p-1 text-popover-foreground shadow-sm',
  'data-[state=closed]:animate-out'
)

export const widgetHeaderMenuItemClassName =
  'group flex w-full cursor-pointer items-center gap-1 rounded-sm p-1.5 font-medium text-muted-foreground text-sm outline-none transition-colors hover:bg-card focus:bg-muted disabled:cursor-not-allowed disabled:opacity-60 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 '

export const widgetHeaderMenuIconClassName =
  'h-3.5 w-3.5 text-muted-foreground hover:text-foreground'
export const widgetHeaderMenuTextClassName = 'hover:text-foreground'

export function widgetHeaderControlClassName(className?: string) {
  return cn(BASE_CONTROL_CLASS, className)
}

export function widgetHeaderIconButtonClassName() {
  return ICON_BUTTON_CLASS
}

interface HoverMenuProps {
  onOpenChange?: (open: boolean) => void
}

export function useWidgetHeaderMenuHover(props: HoverMenuProps = {}) {
  const { onOpenChange } = props
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const closeMenu = useCallback(() => {
    clearCloseTimer()
    setOpen(false)
    onOpenChange?.(false)
  }, [clearCloseTimer, onOpenChange])

  const openMenu = useCallback(() => {
    clearCloseTimer()
    setOpen(true)
    onOpenChange?.(true)
  }, [clearCloseTimer, onOpenChange])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openMenu()
      } else {
        closeMenu()
      }
    },
    [closeMenu, openMenu]
  )

  const scheduleClose = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeMenu()
    }, MENU_TIMERS.CLOSE_DELAY)
  }, [clearCloseTimer, closeMenu])

  const triggerProps = {
    onMouseEnter: openMenu,
    onMouseLeave: scheduleClose,
  }

  const contentProps = {
    onMouseEnter: openMenu,
    onMouseLeave: scheduleClose,
  }

  return {
    open,
    handleOpenChange,
    triggerProps,
    contentProps,
    closeMenu,
  }
}
