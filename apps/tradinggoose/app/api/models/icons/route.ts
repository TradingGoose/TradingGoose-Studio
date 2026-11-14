import { GatewayRegistry } from '@mastra/core/llm'
import { NextResponse } from 'next/server'
import { type ProviderLogoCatalogEntry, resolveProviderLogo } from '@/lib/ui/provider-logos'

export async function GET() {
  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/lobehub/lobe-icons/v6.15.0/src/toc.json',
      {
        cache: 'force-cache',
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!response.ok) throw new Error('Catalog request failed')
    const catalog: ProviderLogoCatalogEntry[] = await response.json()
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('Catalog is unavailable')
    const icons = Object.fromEntries([
      ...catalog.map((brand) => [
        brand.id.toLowerCase(),
        resolveProviderLogo({ id: brand.id, name: brand.title }, catalog),
      ]),
      ...Object.entries(GatewayRegistry.getInstance().getProviders()).map(([id, { name, url }]) => [
        id,
        resolveProviderLogo({ id, name, url }, catalog),
      ]),
    ])
    return NextResponse.json(icons, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    })
  } catch {
    return NextResponse.json(
      { error: 'Provider icons are unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
