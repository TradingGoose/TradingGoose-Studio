export const API_CATALOG_PATH = '/.well-known/api-catalog'
export const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'

type LinkTarget = {
  href: string
  rel: string
  type?: string
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

export function getApiCatalogDocument(origin: string) {
  return {
    linkset: [
      {
        anchor: `${origin}${API_CATALOG_PATH}`,
        item: [
          { href: `${origin}/api/github-stars` },
          { href: `${origin}/api/registration` },
          { href: `${origin}/api/waitlist` },
        ],
      },
    ],
  }
}
