import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

const logger = createLogger('WorkspaceInvitationEmail')

interface WorkspaceInvitationEmailProps {
  workspaceName?: string
  inviterName?: string
  invitationLink?: string
}

export const WorkspaceInvitationEmail = ({
  workspaceName = 'Workspace',
  inviterName = 'Someone',
  invitationLink = '',
}: WorkspaceInvitationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  // Extract token from the link to ensure we're using the correct format
  let enhancedLink = invitationLink

  try {
    // If the link is pointing to any API endpoint directly, update it to use the client route
    if (
      invitationLink.includes('/api/workspaces/invitations/accept') ||
      invitationLink.match(/\/api\/workspaces\/invitations\/[^?]+\?token=/)
    ) {
      const url = new URL(invitationLink)
      const token = url.searchParams.get('token')
      if (token) {
        enhancedLink = `${baseUrl}/invite/${token}?token=${token}`
      }
    }
  } catch (e) {
    logger.error('Error enhancing invitation link:', e)
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>Join the "{workspaceName}" workspace on {brand.name}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;re invited to {workspaceName}</Text>
            <Text style={baseStyles.paragraph}>
              {inviterName} asked you to collaborate in the "{workspaceName}" workspace on{' '}
              {brand.name}. Accept to access shared projects and data.
            </Text>
            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={enhancedLink} style={{ textDecoration: 'none' }}>
                        <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                          Accept Invitation
                        </Text>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={baseStyles.divider} />

            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              This link expires in 7 days. If you didn't request this, you can safely ignore this
              email.
            </Text>
            <Text
              style={{
                ...baseStyles.footerText,
                fontFamily: baseStyles.fontFamily,
                marginTop: '14px',
              }}
            >
              The {brand.name} Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default WorkspaceInvitationEmail
