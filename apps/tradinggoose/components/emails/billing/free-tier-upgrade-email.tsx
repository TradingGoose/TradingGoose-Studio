import * as React from 'react'
import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

interface FreeTierUpgradeEmailProps {
  userName?: string
  currentTierName?: string
  percentUsed?: number
  currentUsage?: number
  limit?: number
  upgradeLink?: string
  recommendedTierName?: string | null
  recommendedTierPriceUsd?: number | null
  recommendedTierIncludedUsageLimitUsd?: number | null
  recommendedTierFeatures?: string[]
  updatedDate?: Date
}

function formatCurrency(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

export function FreeTierUpgradeEmail({
  userName,
  currentTierName = 'your current tier',
  percentUsed = 0,
  currentUsage = 0,
  limit = 0,
  upgradeLink,
  recommendedTierName = null,
  recommendedTierPriceUsd = null,
  recommendedTierIncludedUsageLimitUsd = null,
  recommendedTierFeatures = [],
  updatedDate = new Date(),
}: FreeTierUpgradeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const ctaLink = upgradeLink || `${baseUrl}/billing`
  const recommendedPrice = formatCurrency(recommendedTierPriceUsd)
  const recommendedIncludedUsage = formatCurrency(recommendedTierIncludedUsageLimitUsd)
  const featurePreview = recommendedTierFeatures.slice(0, 3)

  const previewText = `${brand.name}: ${currentTierName} is nearing its included usage`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <Section style={{ padding: '30px 0', textAlign: 'center' }}>
            <Row>
              <Column style={{ textAlign: 'center' }}>
                <Img
                  src={brand.logoUrl || `${baseUrl}/favicon/web-app-manifest-192x192.png`}
                  width='96'
                  height='96'
                  alt={brand.name}
                  style={{
                    margin: '0 auto',
                  }}
                />
              </Column>
            </Row>
          </Section>

          <Section style={baseStyles.sectionsBorders}>
            <Row>
              <Column style={baseStyles.sectionBorder} />
              <Column style={baseStyles.sectionCenter} />
              <Column style={baseStyles.sectionBorder} />
            </Row>
          </Section>

          <Section style={baseStyles.content}>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Hi ${userName},` : 'Hi,'}
            </Text>

            <Text style={baseStyles.paragraph}>
              You've used <strong>${currentUsage.toFixed(2)}</strong> of the{' '}
              <strong>${limit.toFixed(2)}</strong> included in {currentTierName} ({percentUsed}%).
            </Text>

            <Text style={baseStyles.paragraph}>
              Review your available billing tiers now so you can expand your usage before this
              month&apos;s limit interrupts new work.
            </Text>

            {recommendedTierName ? (
              <Section style={baseStyles.codeContainer}>
                <Text
                  style={{
                    ...baseStyles.paragraph,
                    marginTop: 0,
                    marginBottom: 12,
                    fontWeight: 'bold',
                  }}
                >
                  Recommended next tier: {recommendedTierName}
                </Text>
                <Text style={{ ...baseStyles.paragraph, margin: '8px 0', lineHeight: 1.6 }}>
                  {recommendedPrice ? (
                    <>
                      • <strong>Starts at {recommendedPrice}/month</strong>
                      <br />
                    </>
                  ) : null}
                  {recommendedIncludedUsage ? (
                    <>
                      • <strong>{recommendedIncludedUsage}</strong> included usage each month
                      <br />
                    </>
                  ) : null}
                  {featurePreview.map((feature) => (
                    <React.Fragment key={feature}>
                      • {feature}
                      <br />
                    </React.Fragment>
                  ))}
                </Text>
              </Section>
            ) : null}

            <Hr />

            <Text style={baseStyles.paragraph}>
              Open billing settings to review the live tier catalog.
            </Text>

            <Link href={ctaLink} style={{ textDecoration: 'none' }}>
              <Text style={baseStyles.button}>Review Billing Tiers</Text>
            </Link>

            <Text style={baseStyles.paragraph}>
              Questions? We're here to help.
              <br />
              <br />
              Best regards,
              <br />
              The {brand.name} Team
            </Text>

            <Text style={{ ...baseStyles.paragraph, fontSize: '12px', color: '#666' }}>
              Sent on {updatedDate.toLocaleDateString()} • This is a one-time notification after
              your default tier crosses its upgrade threshold.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default FreeTierUpgradeEmail
