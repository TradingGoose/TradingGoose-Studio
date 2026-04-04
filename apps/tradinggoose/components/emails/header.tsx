import * as React from 'react'
import { Img, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'

interface EmailHeaderProps {
  tagline?: string
}

export const EmailHeader = ({ tagline = 'LLM Technical Trading Analysis Workflow System' }: EmailHeaderProps) => {
  const brand = getBrandConfig()
  const baseUrl = getBaseUrl()
  const logoSrc = brand.logoUrl || `${baseUrl}/logo/reverse/small.png`

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
              {tagline ? <Text style={baseStyles.tagline}>{tagline}</Text> : null}
            </td>
          </tr>
        </tbody>

      </table>
    </Section>
  )
}

export default EmailHeader
