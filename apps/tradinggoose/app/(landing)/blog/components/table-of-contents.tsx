'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { TOC } from '../lib/types'

interface TableOfContentsProps {
  toc: TOC[]
}

function useActiveItem(itemIds: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(`#${entry.target.id}`)
          }
        }
      },
      { rootMargin: '0% 0% -80% 0%' }
    )

    for (const id of itemIds) {
      const el = document.getElementById(id.replace('#', ''))
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [itemIds])

  return activeId
}

export default function TableOfContents({ toc }: TableOfContentsProps) {
  const [mounted, setMounted] = useState(false)
  const itemIds = toc.map((item) => item.url)
  const activeHeading = useActiveItem(itemIds)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!toc.length || !mounted) return null

  const minDepth = Math.min(...toc.map((item) => item.depth))

  return (
    <div className="space-y-2">
      <p className="font-medium uppercase">On This Page</p>
      <ul className="m-0 list-none">
        {toc.map((item) => (
          <li key={item.url} className="mt-0">
            <a
              href={item.url}
              className={cn(
                'inline-block border-l-2 py-1.5 pl-4 no-underline transition-all hover:text-primary hover:underline',
                item.url === activeHeading
                  ? 'border-primary text-primary'
                  : 'text-sm text-muted-foreground'
              )}
              style={{ paddingLeft: `${(item.depth - minDepth + 1) * 16}px` }}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
