import { describe, expect, it, vi } from 'vitest'
import {
  getEmailSubject,
  renderPlanWelcomeEmail,
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
})
