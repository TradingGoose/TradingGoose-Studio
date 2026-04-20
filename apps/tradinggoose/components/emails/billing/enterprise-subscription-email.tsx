import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

interface EnterpriseSubscriptionEmailProps {
  userName?: string
  userEmail?: string
  loginLink?: string
  createdDate?: Date
}

export const EnterpriseSubscriptionEmail = ({
  userName = 'Valued User',
  userEmail = '',
  loginLink,
  createdDate = new Date(),
}: EnterpriseSubscriptionEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const effectiveLoginLink = loginLink || `${baseUrl}/login`

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your organization billing is active on {brand.name}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>Organization billing activated</Text>
            <Text style={baseStyles.paragraph}>Welcome aboard, {userName}.</Text>
            <Text style={baseStyles.paragraph}>
              Your organization billing tier is live on {brand.name}. You now have expanded
              capacity, advanced controls, and organization-wide access.
            </Text>

            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={effectiveLoginLink} style={{ textDecoration: 'none' }}>
                        <Text
                          style={{
                            ...baseStyles.button,
                            display: 'inline-block',
                            margin: '22px 0',
                          }}
                        >
                          Access Your Account
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={{ ...baseStyles.paragraph, textAlign: 'left' }}>
              <strong>Next steps</strong>
              <br />- Invite teammates to your organization
              <br />- Configure permissions for workspaces
              <br />- Start building workflows with the new limits
            </Text>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              Need help getting started? Reply to this email and our team will assist you.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
                marginTop: '18px',
              }}
            >
              Sent on {format(createdDate, 'MMMM do, yyyy')}
              {userEmail ? ` to ${userEmail}` : ''}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default EnterpriseSubscriptionEmail
