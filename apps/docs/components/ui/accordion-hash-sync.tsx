'use client'

import { useEffect, useRef } from 'react'

/**
 * Auto-expands collapsed Radix accordion items when clicking TOC links.
 *
 * Fumadocs has built-in hash→accordion on mount, but not for subsequent
 * TOC clicks. This component fills that gap by finding the accordion value
 * from `data-accordion-value` and clicking the trigger to open it.
 */
export function AccordionHashSync() {
  const lastHash = useRef('')

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Find if the click was on a TOC link (a[href^="#"])
      const link = (e.target as HTMLElement).closest?.('a[href^="#"]') as HTMLAnchorElement | null
      if (!link) return

      const hash = link.getAttribute('href')?.slice(1)
      if (!hash) return

      // Use a small delay so the browser updates the hash first
      setTimeout(() => {
        expandToHash(hash)
      }, 10)
    }

    // Handle initial load
    const initialHash = window.location.hash?.slice(1)
    if (initialHash) {
      setTimeout(() => expandToHash(initialHash), 100)
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  return null
}

function expandToHash(hash: string) {
  const target = document.getElementById(hash)
  if (!target) return

  // Walk up from target to find if it's inside a closed accordion content
  let el: HTMLElement | null = target
  while (el) {
    // AccordionPrimitive.Content has class containing 'overflow-hidden'
    // and data-state attribute
    if (el.getAttribute('data-state') === 'closed') {
      // Check if this is an accordion content element
      const parent = el.parentElement
      if (parent) {
        // The AccordionItem contains: Header (with trigger) + Content
        // Find the trigger button in the sibling header
        const trigger = parent.querySelector<HTMLButtonElement>(
          'button[data-radix-collection-item], [role="button"][data-radix-collection-item]'
        )
        if (trigger && trigger.getAttribute('data-state') === 'closed') {
          trigger.click()
          // Scroll after animation
          setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 250)
          return
        }
      }
    }

    // Also check: the heading might be inside the accordion header itself
    // (the id is on the AccordionPrimitive.Header via the `id` prop)
    const accordionValue = el.getAttribute('data-accordion-value')
    if (accordionValue) {
      // This IS the accordion header — find and click its trigger
      const trigger = el.querySelector<HTMLButtonElement>(
        'button[data-radix-collection-item]'
      )
      if (trigger && trigger.getAttribute('data-state') === 'closed') {
        trigger.click()
        setTimeout(() => {
          el!.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 250)
        return
      }
    }

    el = el.parentElement
  }
}
