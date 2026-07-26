import type { Metadata } from 'next'
import Background from '@/app/(landing)/components/background/background'
import { getBaseUrl } from '@/lib/urls/utils'

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getBaseUrl()),
    manifest: '/manifest.webmanifest',
    icons: {
      icon: '/favicon.ico',
      apple: '/apple-icon.png',
    },
    other: {
      'msapplication-TileColor': '#000000',
      'theme-color': '#000000',
    },
  }
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <Background>{children}</Background>
}
