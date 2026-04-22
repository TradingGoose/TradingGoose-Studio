import {
  API_CATALOG_CONTENT_TYPE,
  appendHomepageDiscoveryLinks,
  getApiCatalogDocument,
} from '@/lib/discovery/link-headers'

function createApiCatalogResponse(origin: string, includeBody: boolean) {
  const headers = new Headers({
    'Content-Type': API_CATALOG_CONTENT_TYPE,
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
  })

  appendHomepageDiscoveryLinks(headers)

  return new Response(includeBody ? JSON.stringify(getApiCatalogDocument(origin), null, 2) : null, {
    headers,
  })
}

export async function GET(request: Request) {
  return createApiCatalogResponse(new URL(request.url).origin, true)
}

export async function HEAD(request: Request) {
  return createApiCatalogResponse(new URL(request.url).origin, false)
}
