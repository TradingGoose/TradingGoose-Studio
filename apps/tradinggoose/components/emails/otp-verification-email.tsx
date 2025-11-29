import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from './base-styles'
import EmailFooter from './footer'
import EmailHeader from './header'

interface OTPVerificationEmailProps {
  otp: string
  email?: string
  type?: 'sign-in' | 'email-verification' | 'forget-password' | 'chat-access'
  chatTitle?: string
}

const getSubjectByType = (type: string, brandName: string, chatTitle?: string) => {
  switch (type) {
    case 'sign-in':
      return `Sign in to ${brandName}`
    case 'email-verification':
      return `Verify your email for ${brandName}`
    case 'forget-password':
      return `Reset your ${brandName} password`
    case 'chat-access':
      return `Verification code for ${chatTitle || 'Chat'}`
    default:
      return `Verification code for ${brandName}`
  }
}

export const OTPVerificationEmail = ({
  otp,
  email = '',
  type = 'email-verification',
  chatTitle,
}: OTPVerificationEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  // Get a message based on the type
  const getMessage = () => {
    switch (type) {
      case 'sign-in':
        return `Sign in to ${brand.name}`
      case 'forget-password':
        return `Reset your password for ${brand.name}`
      case 'chat-access':
        return `Access ${chatTitle || 'the chat'}`
      default:
        return `Welcome to ${brand.name}`
    }
  }

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{getSubjectByType(type, brand.name, chatTitle)}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader tagline={type === 'email-verification' ? 'AI-Powered Trading Agent' : undefined} />
          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>{getMessage()}</Text>
            <Text style={baseStyles.paragraph}>Use the code below to continue.</Text>
            <Section style={baseStyles.codeContainer}>
              <Text style={baseStyles.code}>{otp}</Text>
            </Section>
            <Text style={baseStyles.paragraph}>This code expires in 15 minutes.</Text>
            <Text style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}>
              If you didn&apos;t request this code, you can safely ignore this email.
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

export default OTPVerificationEmail
