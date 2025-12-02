import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface InvitationEmailProps {
  inviterName?: string
  organizationName?: string
  inviteLink?: string
  invitedEmail?: string
  updatedDate?: Date
}

const logger = createLogger('InvitationEmail')

export const InvitationEmail = ({
  inviterName = 'A team member',
  organizationName = 'an organization',
  inviteLink = '',
  invitedEmail = '',
  updatedDate = new Date(),
}: InvitationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const preview = `${inviterName} invited you to join ${organizationName} on ${brand.name}`

  // Extract invitation ID or token from inviteLink if present
  let enhancedLink = inviteLink

  // Check if link contains an ID (old format) and append token parameter if needed
  if (inviteLink && !inviteLink.includes('token=')) {
    try {
      const url = new URL(inviteLink)
      const invitationId = url.pathname.split('/').pop()
      if (invitationId) {
        enhancedLink = `${baseUrl}/invite/${invitationId}?token=${invitationId}`
      }
    } catch (e) {
      logger.error('Error parsing invite link:', e)
    }
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{preview}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;ve been invited to join {organizationName}!</Text>
            <Text style={baseStyles.paragraph}>
              <strong>{inviterName}</strong> has invited you to collaborate on {brand.name}. Accept the
              invitation to get access to shared projects and workflows.
            </Text>
            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
                        <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                          Join Now
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={baseStyles.divider} />

            <Text
              style={{
                ...baseStyles.paragraph,
                fontSize: '14px',
                color: '#929eae',
                marginTop: '10px',
              }}
            >
              If you did not expect this invitation, please disregard this email. Invitations expire
              in 48 hours for security.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                marginTop: '18px',
                fontFamily: baseStyles.fontFamily,
              }}
            >
              Sent on {format(updatedDate, 'MMMM do, yyyy')}
              {invitedEmail ? ` to ${invitedEmail}` : ''}.
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default InvitationEmail
