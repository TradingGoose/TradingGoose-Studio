import * as React from 'react'
import { Img, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import { type EmailLocale, getEmailCopy } from '@/components/emails/email-copy'

interface EmailHeaderProps {
  baseUrl?: string
  tagline?: string
  locale?: EmailLocale
}

export const EmailHeader = ({ baseUrl = getBaseUrl(), tagline, locale }: EmailHeaderProps) => {
  const brand = getBrandConfig()
  const logoSrc = `${baseUrl}/favicon/goose.png`
  const copy = getEmailCopy(locale)
  const resolvedTagline = tagline ?? copy.shared.tagline

  return (
    <Section style={baseStyles.header}>
      <table role='presentation' cellPadding={0} cellSpacing={0} style={{ margin: '0 auto' }}>
        <tbody>
          <tr>
            <td style={{ padding: 0 }}>
              <Img
                src={logoSrc}
                width='60'
                height='60'
                alt={brand.name}
                style={{ ...baseStyles.logo, display: 'inline-block', verticalAlign: 'middle' }}
              />
            </td>
            <td style={{ padding: '0 0 0 0px', verticalAlign: 'middle' }}>
              <span style={{ ...baseStyles.brandName, display: 'inline-block', margin: 0 }}>
                {brand.name}
              </span>
              {resolvedTagline ? <Text style={baseStyles.tagline}>{resolvedTagline}</Text> : null}
            </td>
          </tr>
        </tbody>

      </table>
    </Section>
  )
}

export default EmailHeader
