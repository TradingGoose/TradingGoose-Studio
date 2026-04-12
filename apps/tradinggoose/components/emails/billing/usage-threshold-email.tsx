import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

interface UsageThresholdEmailProps {
  userName?: string
  planName: string
  percentUsed: number
  currentUsage: number
  limit: number
  ctaLink?: string
  updatedDate?: Date
}

export function UsageThresholdEmail({
  userName,
  planName,
  percentUsed = 0,
  currentUsage = 0,
  limit = 0,
  ctaLink = '#',
  updatedDate = new Date(),
}: UsageThresholdEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  const previewText = `${brand.name}: You're at ${percentUsed}% of your ${planName} monthly budget`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;re at {percentUsed}% of your budget</Text>
            <Text style={baseStyles.paragraph}>
              {userName ? `${userName}, ` : ''}your {planName} tier usage is nearing the monthly
              limit.
            </Text>

            <Section style={baseStyles.codeContainer}>
              <Text style={{ ...baseStyles.code, letterSpacing: '1px', fontSize: '20px' }}>
                ${currentUsage.toFixed(2)} / ${limit.toFixed(2)} used
              </Text>
              <Text
                style={{
                  ...baseStyles.footerText,
                  marginTop: '6px',
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                {percentUsed}% of this month&apos;s budget
              </Text>
            </Section>

            <Hr style={{ borderColor: '#1f202a', margin: '18px 0' }} />

            <Text style={{ ...baseStyles.paragraph }}>
              To avoid interruptions, consider increasing your monthly limit.
            </Text>

            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={ctaLink} style={{ textDecoration: 'none' }}>
                        <Text
                          style={{
                            ...baseStyles.button,
                            display: 'inline-block',
                            margin: '22px 0',
                          }}
                        >
                          Review limits
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              We send this once when your usage reaches the configured billing warning threshold so
              you have time to adjust your tier or limit.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
                marginTop: '14px',
              }}
            >
              Sent on {updatedDate.toLocaleDateString()}
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default UsageThresholdEmail
