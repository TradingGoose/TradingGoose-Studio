export interface ThemeColors {
  primaryColor: string
  primaryHoverColor: string
  accentColor: string
  accentHoverColor: string
  backgroundColor: string
}

export interface BrandConfig {
  name: string
  supportEmail: string
  documentationUrl: string
  faviconUrl: string
  theme: ThemeColors
}

const brandConfig = Object.freeze<BrandConfig>({
  name: 'TradingGoose Studio',
  supportEmail: 'support@tradinggoose.ai',
  documentationUrl: 'https://docs.tradinggoose.ai/',
  faviconUrl: '/favicon/favicon.ico',
  theme: {
    primaryColor: '#ffcc00',
    primaryHoverColor: '#ffcc0075',
    accentColor: '#ffd600',
    accentHoverColor: '#ffd600cc',
    backgroundColor: '#0c0c0c00',
  },
})

export const getBrandConfig = (): BrandConfig => brandConfig

export const useBrandConfig = (): BrandConfig => brandConfig
