'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IPaneApi } from 'lightweight-charts'

const resolvePaneHost = (pane: IPaneApi<any> | null): HTMLElement | null => {
  if (!pane) return null
  const paneElement = pane.getHTMLElement()
  if (!paneElement) return null
  const paneCell = paneElement.children[1] as HTMLElement | undefined
  const paneWrapper = paneCell?.firstElementChild as HTMLElement | null
  return paneWrapper ?? paneCell ?? paneElement
}

export const PaneOverlayPortal = ({
  pane,
  children,
}: {
  pane: IPaneApi<any> | null
  children: ReactNode
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const host = resolvePaneHost(pane)
    if (!host) return
    if (overlayRef.current && hostRef.current === host) {
      if (!container) {
        setContainer(overlayRef.current)
      }
      return
    }

    if (overlayRef.current) {
      overlayRef.current.remove()
      overlayRef.current = null
    }

    const overlay = document.createElement('div')
    overlay.dataset.overlay = 'pane-controls'
    overlay.style.position = 'absolute'
    overlay.style.left = '0'
    overlay.style.top = '0'
    overlay.style.right = '0'
    overlay.style.bottom = '0'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '5'
    host.appendChild(overlay)
    overlayRef.current = overlay
    hostRef.current = host
    setContainer(overlay)

    return () => {
      if (overlayRef.current === overlay) {
        overlay.remove()
        overlayRef.current = null
        hostRef.current = null
      }
    }
  }, [pane])

  if (!container) return null

  return createPortal(
    <div className='relative h-full w-full pointer-events-none'>{children}</div>,
    container
  )
}
