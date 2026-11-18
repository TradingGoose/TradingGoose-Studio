import { Img, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import { getEmailCopy } from '@/components/emails/email-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { getBaseUrl } from '@/lib/urls/utils'
import type { LocaleInput } from '@/i18n/utils'

interface EmailHeaderProps {
  baseUrl?: string
  locale?: LocaleInput
}

export const EmailHeader = ({ baseUrl = getBaseUrl(), locale }: EmailHeaderProps) => {
  const brand = getBrandConfig()
  const logoSrc = `${baseUrl}/favicon/goose.png`
  const { tagline } = getEmailCopy(locale).shared

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
              <Text style={baseStyles.tagline}>{tagline}</Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  )
}

export default EmailHeader
