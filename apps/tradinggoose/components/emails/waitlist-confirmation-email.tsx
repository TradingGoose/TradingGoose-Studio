import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface WaitlistConfirmationEmailProps {
  email: string
  submittedDate?: Date
}

export const WaitlistConfirmationEmail = ({
  email,
  submittedDate = new Date(),
}: WaitlistConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your access request has been received</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;re on the waitlist</Text>
            <Text style={baseStyles.paragraph}>
              We received your access request for <strong>{brand.name}</strong> and added{' '}
              <Link href={`mailto:${email}`} style={baseStyles.link}>
                {email}
              </Link>{' '}
              to the waitlist.
            </Text>
            <Text style={baseStyles.paragraph}>
              We&apos;ll review your request and email you again if this address is approved for
              sign up. Keep using this same email for every sign-in method.
            </Text>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              If you didn&apos;t request access, you can safely ignore this email.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '18px',
                fontFamily: baseStyles.fontFamily,
              }}
            >
              Submitted on {format(submittedDate, 'MMMM do, yyyy')} to{' '}
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

export default WaitlistConfirmationEmail
