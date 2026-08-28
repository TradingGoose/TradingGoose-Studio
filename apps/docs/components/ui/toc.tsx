'use client'
import { type ComponentProps, createContext, useContext, useRef } from 'react'
import * as Primitive from 'fumadocs-core/toc'
import { useI18n } from 'fumadocs-ui/contexts/i18n'
import { cn } from '../../lib/cn'
import { mergeRefs } from '../../lib/merge-refs'
import { TocThumb } from './toc-thumb'

const TOCContext = createContext<Primitive.TOCItemType[]>([])

export function useTOCItems(): Primitive.TOCItemType[] {
  return useContext(TOCContext)
}

export function TOCProvider({
  toc,
  children,
  ...props
}: ComponentProps<typeof Primitive.AnchorProvider>) {
  return (
    <TOCContext value={toc}>
      <Primitive.AnchorProvider toc={toc} {...props}>
        {children}
      </Primitive.AnchorProvider>
    </TOCContext>
  )
}

export function TOCScrollArea({ ref, className, ...props }: ComponentProps<'div'>) {
  const viewRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={mergeRefs(viewRef, ref)}
      className={cn(
        'relative ms-px min-h-0 overflow-auto py-3 text-sm [mask-image:linear-gradient(to_bottom,transparent,white_16px,white_calc(100%-16px),transparent)] [scrollbar-width:none]',
        className
      )}
      {...props}
    >
      <Primitive.ScrollProvider containerRef={viewRef}>{props.children}</Primitive.ScrollProvider>
    </div>
  )
}

export function TOCItems({ ref, className, ...props }: ComponentProps<'div'>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const items = useTOCItems()
  const { text } = useI18n()

  if (items.length === 0)
    return (
      <div className='rounded-lg border bg-fd-card p-3 text-fd-muted-foreground text-xs'>
        {text.tocNoHeadings}
      </div>
    )

  return (
    <>
      <TocThumb
        containerRef={containerRef}
        className='absolute top-(--fd-top) h-(--fd-height) w-px bg-fd-primary transition-all'
      />
      <div
        ref={mergeRefs(ref, containerRef)}
        className={cn('flex flex-col border-fd-foreground/10 border-s', className)}
        {...props}
      >
        {items.map((item) => (
          <TOCItem key={item.url} item={item} />
        ))}
      </div>
    </>
  )
}

function TOCItem({ item }: { item: Primitive.TOCItemType }) {
  return (
    <Primitive.TOCItem
      href={item.url}
      className={cn(
        'prose py-1.5 text-fd-muted-foreground text-sm transition-colors [overflow-wrap:anywhere] first:pt-0 last:pb-0 data-[active=true]:text-fd-primary',
        item.depth <= 2 && 'ps-3',
        item.depth === 3 && 'ps-6',
        item.depth >= 4 && 'ps-8'
      )}
    >
      {item.title}
    </Primitive.TOCItem>
  )
}
