export const API_CATALOG_PATH = '/.well-known/api-catalog'
export const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'

type LinkTarget = {
  href: string
  rel: string
  type?: string
}

type CatalogLink = {
  href: string
  type?: string
  title?: string
}

const HOMEPAGE_LINK_TARGETS: LinkTarget[] = [
  {
    href: API_CATALOG_PATH,
    rel: 'api-catalog',
    type: 'application/linkset+json',
  },
  {
    href: 'https://docs.tradinggoose.ai',
    rel: 'service-doc',
    type: 'text/html',
  },
  {
    href: '/llms-full.txt',
    rel: 'describedby',
    type: 'text/plain',
  },
]

function formatLinkTarget(target: LinkTarget): string {
  const attributes = [`rel="${target.rel}"`]

  if (target.type) {
    attributes.push(`type="${target.type}"`)
  }

  return `<${target.href}>; ${attributes.join('; ')}`
}

export function appendHomepageDiscoveryLinks(headers: Headers): void {
  HOMEPAGE_LINK_TARGETS.forEach((target) => {
    headers.append('Link', formatLinkTarget(target))
  })
}

const CATALOG_ITEM_LINKS: CatalogLink[] = [
  {
    href: '/api/github-stars',
    type: 'application/json',
    title: 'Public GitHub repository star count endpoint',
  },
  {
    href: '/api/registration',
    type: 'application/json',
    title: 'Current public registration mode endpoint',
  },
  {
    href: '/api/waitlist',
    type: 'application/json',
    title: 'Waitlist submission endpoint for hosted signup access',
  },
]

export function getApiCatalogDocument(origin: string) {
  return {
    linkset: [
      {
        anchor: `${origin}${API_CATALOG_PATH}`,
        item: CATALOG_ITEM_LINKS.map((item) => ({
          href: `${origin}${item.href}`,
          type: item.type,
          title: item.title,
        })),
        'service-doc': [
          {
            href: 'https://docs.tradinggoose.ai',
            type: 'text/html',
            title: 'TradingGoose documentation',
          },
        ],
        describedby: [
          {
            href: `${origin}/llms-full.txt`,
            type: 'text/plain',
            title: 'Machine-readable TradingGoose platform overview',
          },
        ],
      },
    ],
  }
}
