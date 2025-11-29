import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'
import EmailHeader from './header'

interface WorkspaceInvitation {
  workspaceId: string
  workspaceName: string
  permission: 'admin' | 'write' | 'read'
}

interface BatchInvitationEmailProps {
  inviterName: string
  organizationName: string
  organizationRole: 'admin' | 'member'
  workspaceInvitations: WorkspaceInvitation[]
  acceptUrl: string
}

const getPermissionLabel = (permission: string) => {
  switch (permission) {
    case 'admin':
      return 'Admin (full access)'
    case 'write':
      return 'Editor (can edit workflows)'
    case 'read':
      return 'Viewer (read-only access)'
    default:
      return permission
  }
}

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'member':
      return 'Member'
    default:
      return role
  }
}

export const BatchInvitationEmail = ({
  inviterName = 'Someone',
  organizationName = 'the team',
  organizationRole = 'member',
  workspaceInvitations = [],
  acceptUrl,
}: BatchInvitationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const hasWorkspaces = workspaceInvitations.length > 0
  const previewText = `Join ${organizationName} on ${brand.name}`

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>
          {previewText}
          {hasWorkspaces ? ` + ${workspaceInvitations.length} workspace(s)` : ''}
        </Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>You&apos;ve been invited to join {organizationName}.</Text>
            <Text style={baseStyles.paragraph}>
              <strong>{inviterName}</strong> added you as a {getRoleLabel(organizationRole)} on{' '}
              {brand.name}.
            </Text>

            {/* Team Role Information */}
            <Text style={{ ...baseStyles.paragraph, textAlign: 'left' }}>
              {organizationRole === 'admin'
                ? "As an Admin, you'll manage billing, teammates, and workspace access across the organization."
                : "As a Member, you can collaborate on shared billing and accept workspace invites."}
            </Text>

            {/* Workspace Invitations */}
            {hasWorkspaces && (
              <>
                <Text style={{ ...baseStyles.paragraph, textAlign: 'left', marginBottom: '6px' }}>
                  <strong>
                    Workspace Access ({workspaceInvitations.length} workspace
                    {workspaceInvitations.length !== 1 ? 's' : ''}):
                  </strong>
                </Text>
                {workspaceInvitations.map((ws) => (
                  <Text
                    key={ws.workspaceId}
                    style={{
                      ...baseStyles.paragraph,
                      textAlign: 'left',
                      margin: '4px 0 4px 16px',
                    }}
                  >
                    - <strong>{ws.workspaceName}</strong> - {getPermissionLabel(ws.permission)}
                  </Text>
                ))}
              </>
            )}

            <Section>
              <table role='presentation' width='100%'>
                <tbody>
                  <tr>
                    <td align='center'>
                      <Link href={acceptUrl} style={{ textDecoration: 'none' }}>
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

            <Text style={{ ...baseStyles.paragraph, color: '#929eae', fontSize: '14px' }}>
              By accepting, you&apos;ll join {organizationName}
              {hasWorkspaces
                ? ` and unlock access to ${workspaceInvitations.length} workspace(s)`
                : ''}
              . This invitation expires in 7 days.
            </Text>
            <Text style={{ ...baseStyles.footerText, fontFamily: baseStyles.fontFamily, marginTop: '14px' }}>
              The {brand.name} Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default BatchInvitationEmail
