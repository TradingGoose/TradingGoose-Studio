import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface WaitlistApprovedEmailProps {
  email: string
  signupLink: string
  approvedDate?: Date
}

export const WaitlistApprovedEmail = ({
  email,
  signupLink,
  approvedDate = new Date(),
}: WaitlistApprovedEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your waitlist request has been approved</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>Your access is ready</Text>
            <Text style={baseStyles.paragraph}>
              <Link href={`mailto:${email}`} style={baseStyles.link}>
                {email}
              </Link>{' '}
              is now approved to create an account on <strong>{brand.name}</strong>.
            </Text>
            <Text style={baseStyles.paragraph}>
              Finish signing up with this same email address to activate your access.
            </Text>
            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={signupLink} style={{ textDecoration: 'none' }}>
                        <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                          Finish sign up
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={baseStyles.paragraph}>
              If you already created your account with this email, you can ignore this message and
              continue signing in as usual.
            </Text>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              Use the same approved email for email/password, Google, GitHub, or any other sign-in
              method.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '18px',
                fontFamily: baseStyles.fontFamily,
              }}
            >
              Approved on {format(approvedDate, 'MMMM do, yyyy')} for{' '}
              <Link href={`mailto:${email}`} style={baseStyles.link}>
                {email}
              </Link>
              .
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default WaitlistApprovedEmail
