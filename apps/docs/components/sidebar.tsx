'use client';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { usePathname } from 'fumadocs-core/framework';
import {
  type ComponentProps,
  createContext,
  type FC,
  Fragment,
  type ReactNode,
  useContext,
  useMemo,
  useEffect,
  useState,
} from 'react';
import Link, { type LinkProps } from 'fumadocs-core/link';
import { useOnChange } from 'fumadocs-core/utils/use-on-change';
import { cn } from '../lib/cn';
import { ScrollArea, ScrollViewport } from './ui/scroll-area';
import { isActive } from '../lib/is-active';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';
import { type ScrollAreaProps } from '@radix-ui/react-scroll-area';
import { useSidebar } from 'fumadocs-ui/contexts/sidebar';
import { cva } from 'class-variance-authority';
import type {
  CollapsibleContentProps,
  CollapsibleTriggerProps,
} from '@radix-ui/react-collapsible';
import type * as PageTree from 'fumadocs-core/page-tree';
import { useTreeContext, useTreePath } from 'fumadocs-ui/contexts/tree';
import { useMediaQuery } from 'fumadocs-core/utils/use-media-query';
import { Presence } from '@radix-ui/react-presence';
import { useSidebarResize } from '../hooks/use-sidebar-resize';

export interface SidebarProps {
  /**
   * Open folders by default if their level is lower or equal to a specific level
   * (Starting from 1)
   *
   * @defaultValue 0
   */
  defaultOpenLevel?: number;

  /**
   * Prefetch links
   *
   * @defaultValue true
   */
  prefetch?: boolean;

  /**
   * Children to render
   */
  Content: ReactNode;

  /**
   * Alternative children for mobile
   */
  Mobile?: ReactNode;
}

interface InternalContext {
  defaultOpenLevel: number;
  prefetch: boolean;
  level: number;
}

const itemVariants = cva(
  'relative mt-1 flex w-full items-center gap-2  h-8 overflow-hidden rounded-md p-2 ps-(--sidebar-item-offset) text-left text-sm font-sm text-fd-foreground [overflow-wrap:anywhere] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring [&_svg]:size-4 [&_svg]:shrink-0 data-[collapsed=true]:justify-center data-[collapsed=true]:ml-1 data-[collapsed=true]:px-2 data-[collapsed=true]:w-8 data-[collapsed=true]:py-2',
  {
    variants: {
      active: {
        true: 'bg-fd-accent text-fd-foreground',
        false:
          'hover:bg-fd-secondary hover:text-fd-foreground',
      },
    },
  },
);

const Context = createContext<InternalContext | null>(null);
const FolderContext = createContext<{
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

function sidebarWidthFromString(value: string | null, fallback: number) {
  if (!value) return fallback;
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) return fallback;
  return value.trim().endsWith('rem') ? numeric * 16 : numeric;
}

export function Sidebar({
  defaultOpenLevel = 0,
  prefetch = true,
  Mobile,
  Content,
}: SidebarProps) {
  const isMobile = useMediaQuery('(width < 768px)') ?? false;
  const context = useMemo<InternalContext>(() => {
    return {
      defaultOpenLevel,
      prefetch,
      level: 1,
    };
  }, [defaultOpenLevel, prefetch]);

  return (
    <Context.Provider value={context}>
      {isMobile && Mobile != null ? Mobile : Content}
    </Context.Provider>
  );
}

export function SidebarContent(props: ComponentProps<'aside'>) {
  const { collapsed, setCollapsed } = useSidebar();
  const DEFAULT_WIDTH = 224;
  const MIN_WIDTH = 224;
  const MAX_WIDTH = 352;
  const COLLAPSED_WIDTH = 48;

  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const match = document.cookie.match(/docs-sidebar:width=([^;]+)/);
    if (!match) return;
    const cookieWidth = sidebarWidthFromString(
      decodeURIComponent(match[1]),
      DEFAULT_WIDTH,
    );
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, cookieWidth));
    setWidth(clamped);
  }, []);

  // Keep layout padding/nav offsets in sync with the sidebar width.
  useEffect(() => {
    const currentWidth = collapsed ? COLLAPSED_WIDTH : width;
    const px = `${currentWidth}px`;
    document.documentElement.style.setProperty('--fd-sidebar-width', px);
    document.documentElement.style.setProperty('--sidebar-offset', px);
  }, [collapsed, width, COLLAPSED_WIDTH]);

  const { dragRef, handleMouseDown } = useSidebarResize({
    direction: 'right',
    currentWidth: `${width}px`,
    onResize: (nextWidth) => {
      const parsed = sidebarWidthFromString(nextWidth, DEFAULT_WIDTH);
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
      setWidth(clamped);
    },
    onToggle: () => setCollapsed((prev) => !prev),
    isCollapsed: collapsed,
    minResizeWidth: `${MIN_WIDTH}px`,
    maxResizeWidth: `${MAX_WIDTH}px`,
    setIsDraggingRail: setIsDragging,
    widthCookieName: 'docs-sidebar:width',
    widthCookieMaxAge: 60 * 60 * 24 * 30,
  });

  return (
    <aside
      id="nd-sidebar"
      {...props}
      data-collapsed={collapsed}
      data-dragging={isDragging}
      className={cn(
        'fixed left-0 rtl:left-auto rtl:right-(--removed-body-scroll-bar-size,0) top-0 bottom-0 z-20 max-md:hidden',
        'flex flex-col border-r border-fd-border  text-sm text-fd-foreground transition-[width] duration-200',
        'data-[collapsed=true]:items-center data-[collapsed=true]:overflow-hidden',
        isDragging && 'select-none transition-none',
        props.className,
      )}
      style={
        {
          ...props.style,
          width: collapsed ? `${COLLAPSED_WIDTH}px` : `${width}px`,
        } as object
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 data-[collapsed=true]:px-1 data-[collapsed=true]:py-3">
        {props.children}
      </div>
      <button
        ref={dragRef}
        type="button"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute inset-y-0 right-0 w-3 cursor-col-resize select-none opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100"
        onMouseDown={handleMouseDown}
      >
        <span className="pointer-events-none absolute inset-y-0 right-1/2 w-px translate-x-1/2 bg-fd-border" />
      </button>
    </aside>
  );
}

export function SidebarContentMobile({
  className,
  children,
  ...props
}: ComponentProps<'aside'>) {
  const { open, setOpen } = useSidebar();
  const state = open ? 'open' : 'closed';

  return (
    <>
      <Presence present={open}>
        <div
          data-state={state}
          className="fixed z-40 inset-0 backdrop-blur-xs data-[state=open]:animate-fd-fade-in data-[state=closed]:animate-fd-fade-out"
          onClick={() => setOpen(false)}
        />
      </Presence>
      <Presence present={open}>
        {({ present }) => (
          <aside
            id="nd-sidebar-mobile"
            {...props}
            data-state={state}
            className={cn(
              'fixed text-[0.9375rem] flex flex-col border-l border-fd-border shadow-2xl end-0 inset-y-0 w-[85%] max-w-[380px] z-40 bg-fd-card data-[state=open]:animate-fd-sidebar-in data-[state=closed]:animate-fd-sidebar-out',
              !present && 'invisible',
              className,
            )}
          >
            {children}
          </aside>
        )}
      </Presence>
    </>
  );
}

export function SidebarHeader(props: ComponentProps<'div'>) {
  const { className, children, 'data-collapsed': dataCollapsed, ...rest } =
    props as ComponentProps<'div'> & { 'data-collapsed'?: boolean | string };
  const { collapsed } = useSidebar();
  const collapsedState =
    dataCollapsed !== undefined ? dataCollapsed : collapsed;

  return (
    <div
      {...rest}
      className={cn(
        'group flex flex-col gap-2 bg-fd-secondary rounded-md p-2 text-fd-foreground data-[collapsed=true]:items-center  data-[collapsed=true]:p-0',
        className,
      )}
      data-collapsed={collapsedState}
    >
      {children}
    </div>
  );
}

export function SidebarFooter(props: ComponentProps<'div'>) {
  const { className, children, 'data-collapsed': dataCollapsed, ...rest } =
    props as ComponentProps<'div'> & { 'data-collapsed'?: boolean | string };
  const { collapsed } = useSidebar();
  const collapsedState =
    dataCollapsed !== undefined ? dataCollapsed : collapsed;

  return (
    <div
      {...rest}
      className={cn(
        'group flex flex-col gap-2 rounded-md border border-fd-border px-2 py-3 text-fd-foreground data-[collapsed=true]:items-center ',
        className,
      )}
      data-collapsed={collapsedState}
    >
      {children}
    </div>
  );
}

export function SidebarViewport(props: ScrollAreaProps) {
  return (
    <ScrollArea {...props} className={cn('h-full', props.className)}>
      <ScrollViewport
        className="pt-2 overscroll-contain"
        style={
          {
            '--sidebar-item-offset': 'calc(var(--spacing) * 2)',
            maskImage:
              'linear-gradient(to bottom, transparent, white 12px, white calc(100% - 12px), transparent)',
          } as object
        }
      >
        {props.children}
      </ScrollViewport>
    </ScrollArea>
  );
}

export function SidebarSeparator(props: ComponentProps<'p'>) {
  return (
    <p
      {...props}
      className={cn(
        'inline-flex items-center gap-2 mb-2 ps-(--sidebar-item-offset) text-[11px] font-semibold uppercase tracking-wide text-fd-muted-foreground/70 empty:mb-0 [&_svg]:size-4 [&_svg]:shrink-0',
        props.className,
      )}
    >
      {props.children}
    </p>
  );
}

export function SidebarItem({
  icon,
  ...props
}: LinkProps & {
  icon?: ReactNode;
}) {
  const pathname = usePathname();
  const active =
    props.href !== undefined && isActive(props.href, pathname, false);
  const { prefetch } = useInternalContext();
  const { collapsed } = useSidebar();
  const itemLabel =
    typeof props.children === 'string' ? props.children : undefined;

  return (
    <Link
      {...props}
      data-collapsed={collapsed}
      data-active={active}
      className={cn(
        itemVariants({ active }),
        props.className,
      )}
      title={collapsed ? itemLabel : undefined}
      prefetch={prefetch}
    >
      <span className="inline-flex items-center justify-center">
        {icon ?? (props.external ? <ExternalLink /> : null)}
        {!icon && collapsed && (
          <span className="h-1.5 w-1.5 rounded-full bg-fd-muted-foreground/70" />
        )}
      </span>
      <span
        className={cn(
          'truncate',
          collapsed && 'sr-only',
        )}
      >
        {props.children}
      </span>
    </Link>
  );
}

export function SidebarFolder({
  defaultOpen = false,
  ...props
}: ComponentProps<'div'> & {
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { collapsed } = useSidebar();

  useOnChange(defaultOpen, (v) => {
    if (v) setOpen(v);
  });

  return (
    <Collapsible open={!collapsed && open} onOpenChange={setOpen} {...props}>
      <FolderContext.Provider
        value={useMemo(() => ({ open, setOpen }), [open])}
      >
        {props.children}
      </FolderContext.Provider>
    </Collapsible>
  );
}

export function SidebarFolderTrigger({
  className,
  icon,
  label,
  children,
  ...props
}: CollapsibleTriggerProps & {
  icon?: ReactNode;
  label?: ReactNode;
}) {
  const { open } = useFolderContext();
  const { collapsed } = useSidebar();
  const labelString =
    typeof label === 'string'
      ? label
      : typeof children === 'string'
        ? children
        : undefined;

  return (
    <CollapsibleTrigger
      className={cn(
        itemVariants({ active: false }),
        className,
      )}
      {...props}
      data-collapsed={collapsed}
      title={collapsed ? labelString : undefined}
    >
      <span className="inline-flex items-center justify-center">
        {icon ?? (collapsed ? <span className="h-1.5 w-1.5 rounded-full bg-fd-muted-foreground/70" /> : null)}
      </span>
      <span className={cn('truncate w-48', collapsed && 'sr-only')}>
        {label ?? children}
      </span>
      {!collapsed && (
        <ChevronDown
          data-icon
          className={cn(
            'ms-auto text-fd-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
      )}
    </CollapsibleTrigger>
  );
}

export function SidebarFolderLink({
  icon,
  label,
  children,
  ...props
}: LinkProps & {
  icon?: ReactNode;
  label?: ReactNode;
}) {
  const { open, setOpen } = useFolderContext();
  const { prefetch } = useInternalContext();
  const { collapsed } = useSidebar();
  const labelText =
    typeof label === 'string'
      ? label
      : typeof children === 'string'
        ? children
        : undefined;

  const pathname = usePathname();
  const active =
    props.href !== undefined && isActive(props.href, pathname, false);

  return (
    <Link
      {...props}
      data-active={active}
      data-collapsed={collapsed}
      className={cn(
        itemVariants({ active }),
        props.className,
      )}
      onClick={(e) => {
        if (
          !collapsed &&
          e.target instanceof Element &&
          e.target.matches('[data-icon], [data-icon] *')
        ) {
          setOpen(!open);
          e.preventDefault();
        } else {
          setOpen(active ? !open : true);
        }
      }}
      prefetch={prefetch}
      title={collapsed ? labelText : undefined}
    >
      <span className="inline-flex items-center justify-center">
        {icon ?? (collapsed ? <span className="h-1.5 w-1.5  bg-fd-muted-foreground/70" /> : null)}
      </span>
      <span className={cn('truncate', collapsed && 'sr-only')}>
        {label ?? children}
      </span>
      {!collapsed && (
        <ChevronDown
          data-icon
          className={cn(
            'ms-auto text-fd-muted-foreground transition-transform',
            !open && '-rotate-90',
          )}
        />
      )}
    </Link>
  );
}

export function SidebarFolderContent(props: CollapsibleContentProps) {
  const { level, ...ctx } = useInternalContext();
  const { collapsed } = useSidebar();

  return (
    <CollapsibleContent
      {...props}
      className={cn(
        'relative mx-3.5 flex min-w-0 flex-col gap-1 border-l border-fd-border px-2.5 py-1',
        collapsed && 'hidden',
        props.className,
      )}
      style={
        {
          '--sidebar-item-offset': `calc(var(--spacing) * ${(level + 1) * 3})`,
          ...props.style,
        } as object
      }
    >
      <Context.Provider
        value={useMemo(
          () => ({
            ...ctx,
            level: level + 1,
          }),
          [ctx, level],
        )}
      >
        {props.children}
      </Context.Provider>
    </CollapsibleContent>
  );
}

export function SidebarTrigger({
  children,
  ...props
}: ComponentProps<'button'>) {
  const { setOpen } = useSidebar();

  return (
    <button
      {...props}
      aria-label="Open Sidebar"
      onClick={() => setOpen((prev) => !prev)}
    >
      {children}
    </button>
  );
}

export function SidebarCollapseTrigger(props: ComponentProps<'button'>) {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <button
      type="button"
      aria-label="Collapse Sidebar"
      data-collapsed={collapsed}
      {...props}
      onClick={() => {
        setCollapsed((prev) => !prev);
      }}
    >
      {props.children}
    </button>
  );
}

function useFolderContext() {
  const ctx = useContext(FolderContext);
  if (!ctx) throw new Error('Missing sidebar folder');

  return ctx;
}

function useInternalContext() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('<Sidebar /> component required.');

  return ctx;
}

export interface SidebarComponents {
  Item: FC<{ item: PageTree.Item }>;
  Folder: FC<{ item: PageTree.Folder; level: number; children: ReactNode }>;
  Separator: FC<{ item: PageTree.Separator }>;
}

/**
 * Render sidebar items from page tree
 */
export function SidebarPageTree(props: {
  components?: Partial<SidebarComponents>;
}) {
  const { root } = useTreeContext();

  return useMemo(() => {
    const { Separator, Item, Folder } = props.components ?? {};

    function renderSidebarList(
      items: PageTree.Node[],
      level: number,
    ): ReactNode[] {
      return items.map((item, i) => {
        if (item.type === 'separator') {
          if (Separator) return <Separator key={i} item={item} />;
          return (
            <SidebarSeparator key={i} className={cn(i !== 0 && 'mt-6')}>
              {item.icon}
              {item.name}
            </SidebarSeparator>
          );
        }

        if (item.type === 'folder') {
          const children = renderSidebarList(item.children, level + 1);

          if (Folder)
            return (
              <Folder key={i} item={item} level={level}>
                {children}
              </Folder>
            );
          return (
            <PageTreeFolder key={i} item={item}>
              {children}
            </PageTreeFolder>
          );
        }

        if (Item) return <Item key={item.url} item={item} />;
        return (
          <SidebarItem
            key={item.url}
            href={item.url}
            external={item.external}
            icon={item.icon}
          >
            {item.name}
          </SidebarItem>
        );
      });
    }

    return (
      <Fragment key={root.$id}>{renderSidebarList(root.children, 1)}</Fragment>
    );
  }, [props.components, root]);
}

function PageTreeFolder({
  item,
  ...props
}: {
  item: PageTree.Folder;
  children: ReactNode;
}) {
  const { defaultOpenLevel, level } = useInternalContext();
  const path = useTreePath();

  return (
    <SidebarFolder
      defaultOpen={
        (item.defaultOpen ?? defaultOpenLevel >= level) || path.includes(item)
      }
    >
      {item.index ? (
        <SidebarFolderLink
          href={item.index.url}
          external={item.index.external}
          icon={item.icon}
          label={item.name}
          {...props}
        >
        </SidebarFolderLink>
      ) : (
        <SidebarFolderTrigger
          {...props}
          icon={item.icon}
          label={item.name}
        />
      )}
      <SidebarFolderContent>{props.children}</SidebarFolderContent>
    </SidebarFolder>
  );
}
