'use client'

import { useEffect } from 'react'

/**
 * Shared hook for the mouse-follow card glow effect.
 * Queries all `.card` elements on the page, animates the `.blob` border glow,
 * and sets `--shine-x` / `--shine-y` CSS vars for the radial shine gradient.
 */
export function useCardGlow() {
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const cards = document.querySelectorAll('.card')
      cards.forEach((card) => {
        const cardEl = card as HTMLElement

        const blob = cardEl.querySelector('.blob') as HTMLElement
        const fblob = cardEl.querySelector('.fake-blob') as HTMLElement
        if (blob && fblob) {
          const rec = fblob.getBoundingClientRect()
          blob.style.opacity = '0.8'
          blob.animate(
            [
              {
                transform: `translate(${ev.clientX - rec.left - 24 - rec.width / 2}px, ${ev.clientY - rec.top - 24 - rec.height / 2}px)`,
              },
            ],
            { duration: 300, fill: 'forwards' }
          )
        }

        const cardRect = cardEl.getBoundingClientRect()
        const x = ((ev.clientX - cardRect.left) / cardRect.width) * 100
        const y = ((ev.clientY - cardRect.top) / cardRect.height) * 100
        cardEl.style.setProperty('--shine-x', `${x}%`)
        cardEl.style.setProperty('--shine-y', `${y}%`)
      })
    }

    window.addEventListener('mousemove', handler)
    return () => window.removeEventListener('mousemove', handler)
  }, [])
}
