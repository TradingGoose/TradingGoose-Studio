import { describe, expect, it, vi } from 'vitest'
import { formatEmailCurrency } from '@/components/emails/email-copy'
import {
  getEmailSubject,
  renderFreeTierUpgradeEmail,
  renderPaymentFailedEmail,
  renderPlanWelcomeEmail,
  renderUsageThresholdEmail,
  renderWaitlistConfirmationEmail,
  renderWorkspaceInvitationEmail,
} from '@/components/emails/render-email'

vi.mock('@/lib/branding/branding', () => ({
  getBrandConfig: () => ({
    name: 'TradingGoose',
    supportEmail: 'support@tradinggoose.ai',
    documentationUrl: 'https://docs.tradinggoose.ai/',
    faviconUrl: '/favicon/favicon.ico',
    theme: {
      primaryColor: '#ffcc00',
      primaryHoverColor: '#ffcc0075',
      accentColor: '#ffd600',
      accentHoverColor: '#ffd600cc',
      backgroundColor: '#0c0c0c',
    },
  }),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: () => 'https://test.tradinggoose.ai',
}))

describe('localized email rendering', () => {
  it('localizes email subjects by locale', () => {
    expect(getEmailSubject('waitlist-confirmation', 'es')).toBe(
      'Recibimos tu solicitud de acceso a TradingGoose'
    )
    expect(getEmailSubject('chat-access', 'zh', { chatTitle: 'Market Chat' })).toBe(
      'Market Chat 验证码'
    )
  })

  it('renders localized body copy', async () => {
    const html = await renderWaitlistConfirmationEmail('ada@example.com', 'es')

    expect(html).toContain('Estás en la lista de espera')
    expect(html).toContain('ada@example.com')
    expect(html).toContain('https://test.tradinggoose.ai/es/privacy')
    expect(html).toContain('https://test.tradinggoose.ai/es/terms')
    expect(html).toMatch(
      /<a(?=[^>]*href="https:\/\/discord\.gg\/wavf5JWhuT")(?=[^>]*aria-label="Discord")[^>]*>/
    )
    expect(html).toMatch(
      /<a(?=[^>]*href="https:\/\/github\.com\/TradingGoose\/TradingGoose-Studio")(?=[^>]*aria-label="GitHub")[^>]*>/
    )
  })

  it('localizes generated email app links by locale', async () => {
    const html = await renderPlanWelcomeEmail({ planName: 'Pro', locale: 'es' })

    expect(html).toContain('https://test.tradinggoose.ai/es/login')
    expect(html).toContain('https://test.tradinggoose.ai/es/privacy')
    expect(html).toContain('https://test.tradinggoose.ai/es/terms')
  })

  it('renders invite links exactly as supplied', async () => {
    const invitationLink = 'https://test.tradinggoose.ai/invite/invitation-1'
    const html = await renderWorkspaceInvitationEmail({
      workspaceName: 'Research',
      inviterName: 'Ada',
      invitationLink,
      locale: 'en',
    })

    expect(html).toContain(invitationLink)
    expect(html).not.toContain('token=invitation-1')
  })
  it('formats exact financial strings above binary64 precision in localized notices', async () => {
    const currentUsage = '9007199254740993.01'
    const limit = '10000000000000000.01'
    expect(formatEmailCurrency('en', currentUsage)).toBe('$9,007,199,254,740,993.01')
    const html = await renderUsageThresholdEmail({
      planName: 'Pro',
      percentUsed: 90,
      currentUsage,
      limit,
      ctaLink: 'https://test.tradinggoose.ai/es/billing',
      locale: 'es',
    })
    expect(html).toContain(formatEmailCurrency('es', currentUsage))
    expect(html).toContain(formatEmailCurrency('es', limit))
    expect(html).toContain('https://test.tradinggoose.ai/es/billing')
  })
  it('renders known zero recommended money and omits absent optional money', async () => {
    const params = {
      percentUsed: 25,
      currentUsage: '0.25',
      limit: '1',
      upgradeLink: 'https://test.tradinggoose.ai/billing',
      locale: 'en',
    }
    const knownZero = await renderFreeTierUpgradeEmail({
      ...params,
      recommendedTierPriceUsd: '0',
      recommendedTierIncludedUsageLimitUsd: '0',
    })
    expect(knownZero.split('$0.00').length - 1).toBe(2)
    const absent = await renderFreeTierUpgradeEmail({
      ...params,
      recommendedTierPriceUsd: null,
      recommendedTierIncludedUsageLimitUsd: null,
    })
    expect(absent).not.toContain('$0.00')
  })
  it('keeps an unavailable payment amount distinct from a known zero', async () => {
    const paymentUrl = 'https://test.tradinggoose.ai/billing'
    const absent = await renderPaymentFailedEmail({ paymentUrl, locale: 'en' })
    expect(absent).toContain('—')
    expect(absent).not.toContain('$0.00')
    const knownZero = await renderPaymentFailedEmail({ paymentUrl, locale: 'en', amountDue: '0' })
    expect(knownZero).toContain('$0.00')
  })
  it('rejects a numeric financial input instead of adding a float compatibility path', () => {
    expect(() => Reflect.apply(formatEmailCurrency, undefined, ['en', 0.3])).toThrow(
      'decimal strings'
    )
  })
})
