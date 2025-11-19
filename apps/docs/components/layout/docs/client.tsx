'use client';
import { cn } from '../../../lib/cn';
import { type ComponentProps, useMemo } from 'react';
import { useSidebar } from 'fumadocs-ui/contexts/sidebar';
import { useNav } from 'fumadocs-ui/contexts/layout';
import { buttonVariants } from '../../ui/button';
import { Sidebar as SidebarIcon } from 'lucide-react';
import Link from 'fumadocs-core/link';
import { usePathname } from 'fumadocs-core/framework';
import { isTabActive } from '../../../lib/is-active';
import type { Option } from '../../root-toggle';

export function Navbar({
  mode,
  style,
  ...props
}: ComponentProps<'header'> & { mode: 'top' | 'auto' }) {
  const { open } = useSidebar();
  const { isTransparent } = useNav();

  return (
    <header
      id="nd-subnav"
      {...props}
      className={cn(
        'fixed flex flex-col top-(--fd-banner-height) right-(--removed-body-scroll-bar-size,0) z-10 px-(--fd-layout-offset) h-(--fd-nav-height) backdrop-blur-sm transition-colors max-md:[--fd-sidebar-width:0px]',
        (!isTransparent || open) && 'bg-fd-background/80',
        mode === 'auto' &&
        'ps-[calc(var(--fd-layout-offset)+var(--fd-sidebar-width))]',
        props.className,
      )}
      style={{
        ...style,
        insetInlineStart: mode === 'auto' ? ' ' : style?.insetInlineStart,
        width:
          mode === 'auto'
            ? '100%'
            : style?.width,
      }}
    >
      {props.children}
    </header>
  );
}

export function LayoutBody(props: ComponentProps<'main'>) {
  const sidebarWidth = 'var(--fd-sidebar-width)';

  return (
    <main
      id="nd-docs-layout"
      {...props}
      className={cn(
        'flex flex-1 flex-col transition-[padding] pt-(--fd-nav-height) fd-notebook-layout max-md:[--fd-sidebar-width:0px] px-(--fd-layout-offset)',
        props.className,
      )}
      style={{
        ...props.style,
        marginInlineStart: sidebarWidth,
        width: `calc(100% - ${sidebarWidth})`,
        paddingInlineStart: 0,
      }}
    >
      {props.children}
    </main>
  );
}

export function NavbarSidebarTrigger({
  className,
  ...props
}: ComponentProps<'button'>) {
  const { setOpen } = useSidebar();

  return (
    <button
      {...props}
      className={cn(
        buttonVariants({
          color: 'ghost',
          size: 'icon-sm',
          className,
        }),
      )}
      onClick={() => setOpen((prev) => !prev)}
    >
      <SidebarIcon />
    </button>
  );
}

export function LayoutTabs({
  options,
  ...props
}: ComponentProps<'div'> & {
  options: Option[];
}) {
  const pathname = usePathname();
  const selected = useMemo(() => {
    return options.findLast((option) => isTabActive(option, pathname));
  }, [options, pathname]);

  return (
    <div
      {...props}
      className={cn(
        'flex flex-row items-end gap-6 overflow-auto',
        props.className,
      )}
    >
      {options.map((option) => (
        <LayoutTab
          key={option.url}
          selected={selected === option}
          option={option}
        />
      ))}
    </div>
  );
}

function LayoutTab({
  option: { title, url, unlisted, props },
  selected = false,
}: {
  option: Option;
  selected?: boolean;
}) {
  return (
    <Link
      href={url}
      {...props}
      className={cn(
        'inline-flex border-b-2 border-transparent transition-colors items-center pb-1.5 font-medium gap-2 text-fd-muted-foreground text-sm text-nowrap hover:text-fd-accent-foreground',
        unlisted && !selected && 'hidden',
        selected && 'border-fd-primary text-fd-primary',
        props?.className,
      )}
    >
      {title}
    </Link>
  );
}
