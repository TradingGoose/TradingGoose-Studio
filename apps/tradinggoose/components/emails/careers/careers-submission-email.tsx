import * as React from 'react'
import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import { format } from 'date-fns'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'

interface CareersSubmissionEmailProps {
  name: string
  email: string
  phone?: string
  position: string
  linkedin?: string
  portfolio?: string
  experience: string
  location: string
  message: string
  submittedDate?: Date
}

const getExperienceLabel = (experience: string) => {
  const labels: Record<string, string> = {
    '0-1': '0-1 years',
    '1-3': '1-3 years',
    '3-5': '3-5 years',
    '5-10': '5-10 years',
    '10+': '10+ years',
  }
  return labels[experience] || experience
}

export const CareersSubmissionEmail = ({
  name,
  email,
  phone,
  position,
  linkedin,
  portfolio,
  experience,
  location,
  message,
  submittedDate = new Date(),
}: CareersSubmissionEmailProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>New Career Application from {name}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader />

          <Section style={{ ...baseStyles.content, textAlign: 'left' as const }}>
            <Text style={baseStyles.title}>New career application</Text>

            <Text style={{ ...baseStyles.paragraph, textAlign: 'left' }}>
              Submitted on {format(submittedDate, 'MMMM do, yyyy')} at {format(submittedDate, 'h:mm a')}.
            </Text>

            {/* Applicant Information */}
            <Section
              style={{
                marginTop: '18px',
                marginBottom: '18px',
                padding: '18px',
                backgroundColor: '#0f1014',
                borderRadius: '10px',
                border: '1px solid #1d1e26',
              }}
            >
              <Text
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#cfd5e5',
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                Applicant Information
              </Text>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#929eae',
                        width: '38%',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Name
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>{name}</td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#929eae',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Email
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                      <a href={`mailto:${email}`} style={baseStyles.link}>
                        {email}
                      </a>
                    </td>
                  </tr>
                  {phone && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#929eae',
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        Phone
                      </td>
                      <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                        <a href={`tel:${phone}`} style={baseStyles.link}>
                          {phone}
                        </a>
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#929eae',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Position
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                      {position}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#929eae',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Experience
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                      {getExperienceLabel(experience)}
                    </td>
                  </tr>
                  <tr>
                    <td
                      style={{
                        padding: '8px 0',
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#929eae',
                        fontFamily: baseStyles.fontFamily,
                      }}
                    >
                      Location
                    </td>
                    <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                      {location}
                    </td>
                  </tr>
                  {linkedin && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#929eae',
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        LinkedIn
                      </td>
                      <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                        <a href={linkedin} target='_blank' rel='noopener noreferrer' style={baseStyles.link}>
                          View Profile
                        </a>
                      </td>
                    </tr>
                  )}
                  {portfolio && (
                    <tr>
                      <td
                        style={{
                          padding: '8px 0',
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#929eae',
                          fontFamily: baseStyles.fontFamily,
                        }}
                      >
                        Portfolio
                      </td>
                      <td style={{ padding: '8px 0', fontSize: '14px', color: '#cfd5e5' }}>
                        <a href={portfolio} target='_blank' rel='noopener noreferrer' style={baseStyles.link}>
                          View Portfolio
                        </a>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Section>

            {/* Message */}
            <Section
              style={{
                marginTop: '18px',
                marginBottom: '18px',
                padding: '18px',
                backgroundColor: '#0f1014',
                borderRadius: '10px',
                border: '1px solid #1d1e26',
              }}
            >
              <Text
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#cfd5e5',
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                About Themselves
              </Text>
              <Text
                style={{
                  margin: '0',
                  fontSize: '14px',
                  color: '#cfd5e5',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message}
              </Text>
            </Section>

            <Text style={{ ...baseStyles.paragraph, textAlign: 'left' }}>
              Please review this application and reach out to the candidate at your earliest
              convenience.
            </Text>
            <Text style={{ ...baseStyles.footerText, fontFamily: baseStyles.fontFamily, marginTop: '12px' }}>
              The {brand.name} Team
            </Text>
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} />
      </Body>
    </Html>
  )
}

export default CareersSubmissionEmail
