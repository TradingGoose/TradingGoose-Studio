import {
  type ComponentProps,
  type FC,
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  useMemo,
} from 'react';
import {
  type BaseLayoutProps,
  BaseLinkItem,
  type BaseLinkType,
  getLinks,
  type LinkItemType,
} from '../shared/index';
import {
  Sidebar,
  SidebarCollapseTrigger,
  type SidebarComponents,
  SidebarContent,
  SidebarContentMobile,
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarPageTree,
  type SidebarProps,
  SidebarTrigger,
  SidebarViewport,
} from '../../sidebar';
import { TreeContextProvider } from 'fumadocs-ui/contexts/tree';
import { cn } from '../../../lib/cn';
import { buttonVariants } from '../../ui/button';
import {
  Book,
  ChevronDown,
  Languages,
  Sidebar as SidebarIcon,
  X,
} from 'lucide-react';
import { LanguageToggle } from '../../language-toggle';
import { ThemeToggle } from '../../theme-toggle';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../ui/popover';
import type * as PageTree from 'fumadocs-core/page-tree';
import {
  DocsBreadcrumb,
  LayoutBody,
  LayoutTabs,
  Navbar,
  NavbarSidebarTrigger,
} from './client';
import { NavProvider } from 'fumadocs-ui/contexts/layout';
import { type Option, RootToggle } from '../../root-toggle';
import Link from 'fumadocs-core/link';
import {
  LargeSearchToggle,
  SearchToggle,
} from '../../search-toggle';
import {
  getSidebarTabs,
  type GetSidebarTabsOptions,
} from 'fumadocs-ui/utils/get-sidebar-tabs';
import {
  BookOpen,
  Bot,
  Cable,
  Code2,
  Flag,
  Gauge,
  LayoutGrid,
  Network,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Variable,
  Wrench,
  Zap,
} from 'lucide-react';
import type { JSX } from 'react';
import { getFolderSlug, getPageSlug } from '@/lib/page-tree';

const nodeIconMap: Record<string, JSX.Element> = {
  introduction: <Sparkles />,
  'getting-started': <Flag />,
  triggers: <Zap />,
  blocks: <SquareStack />,
  widgets: <LayoutGrid />,
  tools: <Wrench />,
  connections: <Cable />,
  mcp: <Network />,
  copilot: <Bot />,
  knowledgebase: <BookOpen />,
  variables: <Variable />,
  execution: <Gauge />,
  permissions: <ShieldCheck />,
  sdks: <Code2 />,
};

function addNodeIcons(root: PageTree.Root): PageTree.Root {
  const withItemIcon = (item: PageTree.Item): PageTree.Item => {
    const slug = getPageSlug(item);
    const icon = item.icon ?? (slug ? nodeIconMap[slug] : undefined);
    if (!icon) return item;
    return {
      ...item,
      icon,
    };
  };

  const mapNode = (node: PageTree.Node): PageTree.Node => {
    if (node.type === 'folder') {
      const slug = getFolderSlug(node);
      const icon = node.icon ?? (slug ? nodeIconMap[slug] : undefined);

      return {
        ...node,
        icon,
        index: node.index ? withItemIcon(node.index) : undefined,
        children: node.children.map((child) => {
          if (child.type === 'folder') return mapNode(child);
          if (child.type === 'page') return withItemIcon(child);
          return child;
        }),
      };
    }

    if (node.type === 'page') {
      return withItemIcon(node);
    }

    return node;
  };

  return {
    ...root,
    children: root.children.map(mapNode),
    fallback: root.fallback ? addNodeIcons(root.fallback) : undefined,
  };
}

function promoteFolderIndexes(root: PageTree.Root): PageTree.Root {
  const mapNode = (node: PageTree.Node): PageTree.Node => {
    if (node.type !== 'folder') return node;

    const basePaths = getFolderBasePaths(node);
    let assignedIndex = node.index;
    const children: PageTree.Node[] = [];

    for (const child of node.children) {
      if (
        !assignedIndex &&
        child.type === 'page' &&
        isFolderIndexCandidate(child, basePaths)
      ) {
        assignedIndex = child;
        continue;
      }

      children.push(
        child.type === 'folder' ? mapNode(child) : child,
      );
    }

    return {
      ...node,
      index: assignedIndex,
      children,
    };
  };

  return {
    ...root,
    children: root.children.map(mapNode),
    fallback: root.fallback ? promoteFolderIndexes(root.fallback) : undefined,
  };
}

function getFolderBasePaths(folder: PageTree.Folder): string[] {
  const bases = new Set<string>();
  const fromMeta = normalizePath(folder.$ref?.metaFile)?.replace(/\/meta\.json$/, '');
  if (fromMeta) bases.add(trimSlashes(fromMeta));

  if (typeof folder.$id === 'string' && folder.$id.trim().length > 0) {
    bases.add(trimSlashes(folder.$id));
  }

  if (folder.index?.url) bases.add(trimSlashes(folder.index.url));

  const childDirs = folder.children
    .map((child) => {
      if (child.type !== 'page') return null;
      const normalized = normalizePath(child.$ref?.file);
      if (!normalized) return null;
      const dir = normalized.includes('/')
        ? normalized.slice(0, normalized.lastIndexOf('/'))
        : '';
      return trimSlashes(dir);
    })
    .filter((dir): dir is string => Boolean(dir));

  const common = getCommonPathPrefix(childDirs);
  if (common) bases.add(common);

  return Array.from(bases).filter(Boolean);
}

function isFolderIndexCandidate(
  child: PageTree.Item,
  basePaths: string[],
): boolean {
  if (basePaths.length === 0) return false;
  const normalizedFile = normalizePath(child.$ref?.file);
  if (!normalizedFile || !normalizedFile.endsWith('index.mdx')) return false;

  const fileBase = trimSlashes(
    normalizedFile.replace(/\/index\.mdx$/, ''),
  );
  const urlBase = trimSlashes(child.url);

  return basePaths.some(
    (base) => base === fileBase || base === urlBase,
  );
}

function normalizePath(value?: string | null) {
  return value?.replace(/\\/g, '/').replace(/^\.\//, '');
}

function trimSlashes(value?: string | null) {
  if (!value) return '';
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function getCommonPathPrefix(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const segments = paths.map((path) => trimSlashes(path).split('/'));
  let prefix = segments[0];

  for (const parts of segments.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }

  return prefix.length > 0 ? prefix.join('/') : undefined;
}

export interface DocsLayoutProps extends BaseLayoutProps {
  tree: PageTree.Root;
  tabMode?: 'sidebar' | 'navbar';

  nav?: BaseLayoutProps['nav'] & {
    mode?: 'top' | 'auto';
    logo?: ReactNode;
  };

  sidebar?: SidebarOptions;

  containerProps?: HTMLAttributes<HTMLDivElement>;
}

interface SidebarOptions
  extends ComponentProps<'aside'>,
  Pick<SidebarProps, 'defaultOpenLevel' | 'prefetch'> {
  components?: Partial<SidebarComponents>;

  /**
   * Root Toggle options
   */
  tabs?: Option[] | GetSidebarTabsOptions | false;

  banner?: ReactNode | FC<ComponentProps<typeof SidebarHeader>>;
  footer?: ReactNode | FC<ComponentProps<typeof SidebarFooter>>;

  /**
   * Support collapsing the sidebar on desktop mode
   *
   * @defaultValue true
   */
  collapsible?: boolean;
}

export function DocsLayout(props: DocsLayoutProps) {
  const {
    tabMode = 'sidebar',
    nav: { transparentMode, ...nav } = {},
    sidebar: { tabs: tabOptions, ...sidebarProps } = {},
    i18n = false,
    themeSwitch = {},
  } = props;

  const navMode = nav.mode ?? 'auto';
  const links = getLinks(props.links ?? [], props.githubUrl);
  const treeWithPromotedIndexes = useMemo(
    () => promoteFolderIndexes(props.tree),
    [props.tree],
  );
  const treeWithIcons = useMemo(
    () => addNodeIcons(treeWithPromotedIndexes),
    [treeWithPromotedIndexes],
  );
  const tabs = useMemo(() => {
    if (Array.isArray(tabOptions)) {
      return tabOptions;
    }

    if (tabOptions && typeof tabOptions === 'object') {
      return getSidebarTabs(treeWithPromotedIndexes, tabOptions);
    }

    if (tabOptions !== false) {
      return getSidebarTabs(treeWithPromotedIndexes);
    }

    return [];
  }, [tabOptions, treeWithPromotedIndexes]);

  function sidebar() {
    const {
      banner,
      footer,
      components,
      collapsible = true,
      prefetch,
      defaultOpenLevel,
      ...rest
    } = sidebarProps;
    const Header =
      typeof banner === 'function'
        ? banner
        : (props: ComponentProps<typeof SidebarHeader>) => (
          <SidebarHeader {...props}>
            {props.children}
            {banner}
          </SidebarHeader>
        );
    const Footer =
      typeof footer === 'function'
        ? footer
        : (props: ComponentProps<typeof SidebarFooter>) => (
          <SidebarFooter {...props}>
            {props.children}
            {footer}
          </SidebarFooter>
        );
    const iconLinks = links.filter((item) => item.type === 'icon');
    const navLogo = nav.logo;

    const rootToggle = (
      <>
        {tabMode === 'sidebar' && tabs.length > 0 && (
          <RootToggle className="mb-2" options={tabs} />
        )}
        {tabMode === 'navbar' && tabs.length > 0 && (
          <RootToggle options={tabs} className="lg:hidden" />
        )}
      </>
    );

    const viewport = (
      <SidebarViewport>
        {links
          .filter((item) => item.type !== 'icon')
          .map((item, i, arr) => (
            <SidebarLinkItem
              key={i}
              item={item}
              className={cn('lg:hidden', i === arr.length - 1 && 'mb-4')}
            />
          ))}

        <SidebarPageTree components={components} />
      </SidebarViewport>
    );

    const content = (
      <SidebarContent
        {...rest}
        className={cn(
          navMode === 'top'
            ? 'border-e-0 bg-transparent'
            : '[--fd-nav-height:0px]',
          rest.className,
        )}
      >
        <Header className="empty:hidden ">
          {navMode === 'auto' && (
            <div className="flex justify-between ">
              <Link
                href={nav.url ?? '/'}
                className="inline-flex items-center gap-2.5 font-medium"
              >
                <span className="inline-flex shrink-0 items-center justify-center">
                  {navLogo ?? <div className="h-8 w-8 rounded-md bg-fd-primary" />}
                </span>
                <div className="group-data-[collapsed=true]:hidden grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    TradingGoose</span>
                  <span className='truncate text-xs font-light'>
                    Docs</span>
                </div>
              </Link>
            </div>
          )}
          {nav.children}
          {rootToggle}
        </Header>
        {viewport}
        <Footer
          className={cn(
            'hidden flex-row text-fd-muted-foreground items-center',
            iconLinks.length > 0 && 'max-lg:flex',
          )}
        >
          {iconLinks.map((item, i) => (
            <BaseLinkItem
              key={i}
              item={item}
              className={cn(
                buttonVariants({
                  size: 'icon-sm',
                  color: 'ghost',
                  className: 'lg:hidden',
                }),
              )}
              aria-label={item.label}
            >
              {item.icon}
            </BaseLinkItem>
          ))}
        </Footer>
      </SidebarContent>
    );

    const mobile = (
      <SidebarContentMobile {...rest}>
        <Header>
          <SidebarTrigger
            className={cn(
              buttonVariants({
                size: 'icon-sm',
                color: 'ghost',
                className: 'ms-auto text-fd-muted-foreground',
              }),
            )}
          >
            <X />
          </SidebarTrigger>
          {rootToggle}
        </Header>
        {viewport}
        <Footer
          className={cn(
            'hidden flex-row items-center justify-end',
            (i18n || themeSwitch.enabled !== false) && 'flex',
            iconLinks.length > 0 && 'max-lg:flex',
          )}
        >
          {iconLinks.map((item, i) => (
            <BaseLinkItem
              key={i}
              item={item}
              className={cn(
                buttonVariants({
                  size: 'icon-sm',
                  color: 'ghost',
                }),
                'text-fd-muted-foreground lg:hidden',
                i === iconLinks.length - 1 && 'me-auto',
              )}
              aria-label={item.label}
            >
              {item.icon}
            </BaseLinkItem>
          ))}
          {i18n && (
            <LanguageToggle>
              <Languages className="size-4.5 text-fd-muted-foreground" />
            </LanguageToggle>
          )}
          {themeSwitch.enabled !== false &&
            (themeSwitch.component ?? (
              <ThemeToggle mode={themeSwitch.mode ?? 'light-dark-system'} />
            ))}
        </Footer>
      </SidebarContentMobile>
    );

    return (
      <Sidebar
        defaultOpenLevel={defaultOpenLevel}
        prefetch={prefetch}
        Content={content}
        Mobile={mobile}
      />
    );
  }

  return (
    <TreeContextProvider tree={treeWithIcons}>
      <NavProvider transparentMode={transparentMode}>
        <LayoutBody
          {...props.containerProps}
          className={cn(props.containerProps?.className)}
          sidebar={sidebar()}
          navbar={
            <DocsNavbar
              {...props}
              links={links}
              tabs={tabMode == 'navbar' ? tabs : []}
            />
          }
        >
          {props.children}
        </LayoutBody>
      </NavProvider>
    </TreeContextProvider>
  );
}

function DocsNavbar({
  links,
  tabs,
  sidebar: { collapsible: sidebarCollapsible = true } = {},
  searchToggle = {},
  themeSwitch = {},
  nav = {},
  i18n,
}: DocsLayoutProps & {
  links: LinkItemType[];
  tabs: Option[];
}) {
  const iconLinks = links.filter((item) => item.type === 'icon');
  const navLinks = links.filter((item) => item.type !== 'icon');
  const navTitle = nav.title ?? 'Docs';

  return (
    <Navbar>
      <div className="flex h-14 items-center gap-3 border-b px-4 ">
        <div className="flex items-center gap-2">
          {sidebarCollapsible && (
            <SidebarCollapseTrigger
              className="hidden h-7 w-7 items-center justify-center rounded-full text-fd-muted-foreground transition-colors  hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring md:inline-flex"
            >
              <SidebarIcon className="size-4" />
            </SidebarCollapseTrigger>
          )}
        </div>
        <span className="hidden h-6 w-px bg-fd-border md:block" />
        <div className="flex w-full flex-nowrap gap-4 text-sm text-fd-muted-foreground">
          <div className="flex min-w-0 flex-grow basis-0 items-center gap-3">
            <DocsBreadcrumb
              icon={<BookOpen className="size-4" />}
              label={navTitle}
              href={nav.url ?? '/'}
              className="hidden min-w-0 flex-1 sm:flex"
            />
            <div className="hidden items-center gap-4 md:flex">
              {navLinks.map((item, i) => (
                <NavbarLinkItem
                  key={i}
                  item={item}
                  className="text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                />
              ))}
            </div>
          </div>
          <div className="hidden min-w-0 flex-grow basis-0 items-center justify-center lg:flex">
            {searchToggle.enabled !== false &&
              (searchToggle.components?.lg ? (
                <div className="w-full max-w-lg">
                  {searchToggle.components.lg}
                </div>
              ) : (
                <LargeSearchToggle hideIfDisabled className="w-full max-w-lg" />
              ))}
          </div>
          <div className="flex min-w-0 flex-grow basis-0 items-center justify-end gap-2">
            {nav.children}
            {iconLinks.map((item, i) => (
              <BaseLinkItem
                key={i}
                item={item}
                className={cn(
                  buttonVariants({ size: 'icon-sm', color: 'ghost' }),
                  'hidden text-fd-muted-foreground lg:inline-flex',
                )}
                aria-label={item.label}
              >
                {item.icon}
              </BaseLinkItem>
            ))}
            {i18n && (
              <LanguageToggle>
                <Languages className="size-4.5 text-fd-muted-foreground" />
              </LanguageToggle>
            )}
            {themeSwitch.enabled !== false &&
              (themeSwitch.component ?? (
                <ThemeToggle mode={themeSwitch.mode ?? 'light-dark-system'} />
              ))}
            {searchToggle.enabled !== false &&
              (searchToggle.components?.sm ?? (
                <SearchToggle hideIfDisabled className="px-2 py-1.5 lg:hidden" />
              ))}
          </div>
        </div>
      </div>
      {navLinks.length > 0 && (
        <div className="flex flex-wrap gap-3 border-b border-fd-border px-4 py-2 md:hidden">
          {navLinks.map((item, i) => (
            <NavbarLinkItem
              key={i}
              item={item}
              className="text-sm text-fd-muted-foreground"
            />
          ))}
        </div>
      )}
      {tabs.length > 0 && (
        <LayoutTabs
          className="border-t border-fd-border py-2"
          options={tabs}
        />
      )}
    </Navbar>
  );
}

function NavbarLinkItem({
  item,
  ...props
}: { item: LinkItemType } & HTMLAttributes<HTMLElement>) {
  if (item.type === 'menu') {
    return (
      <Popover>
        <PopoverTrigger
          {...props}
          className={cn(
            'inline-flex items-center gap-1.5 has-data-[active=true]:text-fd-primary',
            props.className,
          )}
        >
          {item.url ? (
            <BaseLinkItem item={item as BaseLinkType}>{item.text}</BaseLinkItem>
          ) : (
            item.text
          )}
          <ChevronDown className="size-3" />
        </PopoverTrigger>
        <PopoverContent className="flex flex-col">
          {item.items.map((child, i) => {
            if (child.type === 'custom')
              return <Fragment key={i}>{child.children}</Fragment>;

            return (
              <BaseLinkItem
                key={i}
                item={child}
                className="inline-flex items-center gap-2 rounded-md p-2 text-start hover:bg-fd-accent hover:text-fd-accent-foreground data-[active=true]:text-fd-primary [&_svg]:size-4"
              >
                {child.icon}
                {child.text}
              </BaseLinkItem>
            );
          })}
        </PopoverContent>
      </Popover>
    );
  }

  if (item.type === 'custom') return item.children;

  return (
    <BaseLinkItem item={item} {...props}>
      {item.text}
    </BaseLinkItem>
  );
}

function SidebarLinkItem({
  item,
  ...props
}: {
  item: Exclude<LinkItemType, { type: 'icon' }>;
  className?: string;
}) {
  if (item.type === 'menu')
    return (
      <SidebarFolder {...props}>
        {item.url ? (
          <SidebarFolderLink
            href={item.url}
            external={item.external}
            icon={item.icon}
            label={item.text}
          />
        ) : (
          <SidebarFolderTrigger icon={item.icon} label={item.text} />
        )}
        <SidebarFolderContent>
          {item.items.map((child, i) => (
            <SidebarLinkItem key={i} item={child} />
          ))}
        </SidebarFolderContent>
      </SidebarFolder>
    );

  if (item.type === 'custom') return <div {...props}>{item.children}</div>;

  return (
    <SidebarItem
      href={item.url}
      icon={item.icon}
      external={item.external}
      {...props}
    >
      {item.text}
    </SidebarItem>
  );
}

export { Navbar, NavbarSidebarTrigger };
