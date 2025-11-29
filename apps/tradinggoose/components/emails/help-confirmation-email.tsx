import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'
import EmailHeader from './header'

interface HelpConfirmationEmailProps {
  userEmail?: string
  type?: 'bug' | 'feedback' | 'feature_request' | 'other'
  attachmentCount?: number
  submittedDate?: Date
}

const getTypeLabel = (type: string) => {
  switch (type) {
    case 'bug':
      return 'Bug Report'
    case 'feedback':
      return 'Feedback'
    case 'feature_request':
      return 'Feature Request'
    case 'other':
      return 'General Inquiry'
    default:
      return 'Request'
  }
}

export const HelpConfirmationEmail = ({
  userEmail = '',
  type = 'other',
  attachmentCount = 0,
  submittedDate = new Date(),
}: HelpConfirmationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const typeLabel = getTypeLabel(type)

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{brand.name}: we received your {typeLabel.toLowerCase()}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>Thanks for reaching out</Text>
            <Text style={baseStyles.paragraph}>
              We received your <strong>{typeLabel.toLowerCase()}</strong> and will follow up shortly.
            </Text>

            {attachmentCount > 0 && (
              <Text style={baseStyles.paragraph}>
                You attached <strong>{attachmentCount} file{attachmentCount > 1 ? 's' : ''}</strong>
                . We&apos;ll review everything you shared.
              </Text>
            )}

            <Text style={baseStyles.paragraph}>
              We typically respond to{' '}
              {type === 'bug'
                ? 'bug reports'
                : type === 'feature_request'
                  ? 'feature requests'
                  : 'inquiries'}{' '}
              within a few hours. If you need immediate help, email us anytime at{' '}
              <a href={`mailto:${brand.supportEmail}`} style={baseStyles.link}>
                {brand.supportEmail}
              </a>
              .
            </Text>

            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '18px',
                fontFamily: baseStyles.fontFamily,
              }}
            >
              Sent on {format(submittedDate, 'MMMM do, yyyy')} for your {typeLabel.toLowerCase()}
              {userEmail ? ` from ${userEmail}` : ''}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default HelpConfirmationEmail
