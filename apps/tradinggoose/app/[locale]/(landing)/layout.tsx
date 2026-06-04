import type { Metadata } from 'next'
import Background from '@/app/(landing)/components/background/background'
import { SITE_BASE_URL } from '@/i18n/utils'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_BASE_URL),
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

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <Background>{children}</Background>
}
