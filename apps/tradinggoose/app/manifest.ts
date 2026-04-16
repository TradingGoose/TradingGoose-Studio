import type { MetadataRoute } from 'next'
import { getBrandConfig } from '@/lib/branding/branding'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()

  return {
    name: brand.name,
    short_name: brand.name,
    description:
      'Open-source visual workflow platform for technical LLM-driven trading. Build custom indicators, monitor live markets, and trigger AI agent workflows on signals.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: brand.theme.primaryColor,
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/favicon/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    categories: ['finance', 'productivity', 'developer'],
    shortcuts: [
      {
        name: 'Create Trading Workflow',
        short_name: 'New',
        description: 'Create a new trading workflow',
        url: '/workspace',
      },
    ],
    lang: 'en-US',
    dir: 'ltr',
  }
}
