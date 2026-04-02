import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

export const NewsletterWelcomeEmail = () => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Welcome to {brand.name} updates</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />
          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;re in!</Text>
            <Text style={baseStyles.paragraph}>
              Thanks for subscribing to {brand.name} updates. You&apos;ll get notified about new
              features, releases, and tips for building AI trading workflows.
            </Text>
            <Text style={baseStyles.paragraph}>
              For the most recent updates and community news, join us on Discord — it&apos;s where
              we share releases first, answer questions, and showcase what the community is building.
            </Text>
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Link
                href='https://discord.gg/wavf5JWhuT'
                style={baseStyles.button}
              >
                Join Discord
              </Link>
            </Section>
            <Text style={baseStyles.paragraph}>More resources:</Text>
            <Section style={{ padding: '4px 0' }}>
              <Text style={{ ...baseStyles.paragraph, margin: '6px 0' }}>
                <Link href='https://docs.tradinggoose.ai' style={baseStyles.link}>
                  Documentation
                </Link>
                {' — '}Learn how to build workflows
              </Text>
              <Text style={{ ...baseStyles.paragraph, margin: '6px 0' }}>
                <Link href='https://github.com/TradingGoose/TradingGoose-Studio' style={baseStyles.link}>
                  GitHub
                </Link>
                {' — '}Star the repo, report issues
              </Text>
            </Section>
            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
                marginTop: '14px',
              }}
            >
              The {brand.name} Team
            </Text>
          </Section>
        </Container>
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default NewsletterWelcomeEmail
