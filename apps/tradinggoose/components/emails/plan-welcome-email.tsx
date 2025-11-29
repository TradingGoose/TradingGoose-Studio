import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import EmailFooter from './footer'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'
import EmailHeader from './header'

interface PlanWelcomeEmailProps {
  planName: 'Pro' | 'Team'
  userName?: string
  loginLink?: string
  createdDate?: Date
}

export function PlanWelcomeEmail({
  planName,
  userName,
  loginLink,
  createdDate = new Date(),
}: PlanWelcomeEmailProps) {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const cta = loginLink || `${baseUrl}/login`

  const previewText = `${brand.name}: Your ${planName} plan is active`

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={baseStyles.main}>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>{planName} plan activated</Text>
            <Text style={{ ...baseStyles.paragraph, marginTop: 0 }}>
              {userName ? `Welcome, ${userName}!` : 'Welcome!'}
            </Text>
            <Text style={baseStyles.paragraph}>
              You&apos;re all set on the <strong>{planName}</strong> plan for {brand.name}. Explore
              your new limits and ship faster with your team.
            </Text>

            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={cta} style={{ textDecoration: 'none' }}>
                        <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                          Open {brand.name}
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={baseStyles.paragraph}>
              Want to discuss your plan or get personalized help getting started?{' '}
              <Link href='https://cal.com/waleedlatif/15min' style={baseStyles.link}>
                Schedule a 15-minute call
              </Link>{' '}
              with our team.
            </Text>

            <Hr style={{ borderColor: '#1f202a', margin: '18px 0' }} />

            <Text style={baseStyles.paragraph}>
              Need to invite teammates, adjust usage limits, or manage billing? Visit Settings {'->'}
              Subscription anytime.
            </Text>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.footerText, fontFamily: baseStyles.fontFamily }}>
              The {brand.name} Team
              <br />
              Sent on {createdDate.toLocaleDateString()}
            </Text>
          </Section>
        </Container>
        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default PlanWelcomeEmail
