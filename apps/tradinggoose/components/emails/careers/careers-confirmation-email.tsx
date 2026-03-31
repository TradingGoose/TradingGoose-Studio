import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface CareersConfirmationEmailProps {
  name: string
  position: string
  submittedDate?: Date
}

export const CareersConfirmationEmail = ({
  name,
  position,
  submittedDate = new Date(),
}: CareersConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Your application to {brand.name} has been received</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>We received your application</Text>
            <Text style={baseStyles.paragraph}>Hello {name},</Text>
            <Text style={baseStyles.paragraph}>
              Thanks for your interest in joining the {brand.name} team. We&apos;ve received your
              application for the <strong>{position}</strong> role.
            </Text>

            <Text style={baseStyles.paragraph}>
              Our team carefully reviews every application and will get back to you within the next
              few weeks. If your qualifications match what we're looking for, we'll reach out to
              schedule an initial conversation.
            </Text>

            <Text style={baseStyles.paragraph}>
              In the meantime, explore our{' '}
              <a
                href='https://docs.tradinggoose.ai'
                target='_blank'
                rel='noopener noreferrer'
                style={baseStyles.link}
              >
                documentation
              </a>{' '}
              to see what we&apos;re building, or read the latest on our{' '}
              <a href={`${baseUrl}/blog`} style={baseStyles.link}>
                blog
              </a>
              .
            </Text>

            <Section style={baseStyles.divider} />

            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
              }}
            >
              The {brand.name} Team
            </Text>

            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '18px',
                fontFamily: baseStyles.fontFamily,
              }}
            >
              This confirmation was sent on {format(submittedDate, 'MMMM do, yyyy')} at{' '}
              {format(submittedDate, 'h:mm a')}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default CareersConfirmationEmail
