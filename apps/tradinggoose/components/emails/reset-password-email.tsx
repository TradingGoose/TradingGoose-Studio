import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface ResetPasswordEmailProps {
  username?: string
  resetLink?: string
  updatedDate?: Date
}

export const ResetPasswordEmail = ({
  username = '',
  resetLink = '',
  updatedDate = new Date(),
}: ResetPasswordEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Reset your {brand.name} password</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>Reset your password</Text>
            <Text style={baseStyles.paragraph}>
              We received a request to reset the password for your {brand.name} account.
            </Text>
            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={resetLink} style={{ textDecoration: 'none' }}>
                        <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                          Reset Password
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
            <Text style={baseStyles.paragraph}>This link is valid for the next 24 hours.</Text>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              If you didn&apos;t request this, no action is needed. Your account stays secure unless the
              link above is used.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
                marginTop: '18px',
              }}
            >
              Sent on {format(updatedDate, 'MMMM do, yyyy')} to {username || 'your account email'}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default ResetPasswordEmail
