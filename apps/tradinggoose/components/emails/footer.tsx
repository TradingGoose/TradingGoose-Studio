import { Container, Img, Link, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import { emailText, getEmailCopy } from '@/components/emails/email-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { isHosted } from '@/lib/environment'
import { type LocaleInput, localizeSiteUrl, normalizeLocaleCode } from '@/i18n/utils'

interface EmailFooterProps {
  unsubscribeUrl?: string
  locale?: LocaleInput
}

export default function EmailFooter({ locale, unsubscribeUrl }: EmailFooterProps) {
  const resolvedLocale = normalizeLocaleCode(locale)
  const copy = getEmailCopy(resolvedLocale)
  const brand = getBrandConfig()
  const year = new Date().getFullYear()
  const linkStyle = { ...baseStyles.link, fontWeight: 600, fontFamily: baseStyles.fontFamily }
  const privacyUrl = localizeSiteUrl(resolvedLocale, '/privacy')
  const termsUrl = localizeSiteUrl(resolvedLocale, '/terms')

  return (
    <Container style={baseStyles.footer}>
      <Section style={{ padding: '0 0 8px 0' }}>
        <table style={{ width: '100%' }}>
          <tbody>
            <tr>
              <td align='center'>
                <table cellPadding={0} cellSpacing={0} style={{ border: 0 }}>
                  <tbody>
                    <tr>
                      <td align='center' style={{ padding: '0 8px' }}>
                        <Link
                          href='https://discord.gg/wavf5JWhuT'
                          rel='noopener noreferrer'
                          aria-label='Discord'
                        >
                          <Img
                            src='https://avatars.githubusercontent.com/u/1965106'
                            width='24'
                            height='24'
                            alt='Discord'
                            style={{ borderRadius: '50%' }}
                          />
                        </Link>
                      </td>
                      <td align='center' style={{ padding: '0 8px' }}>
                        <Link
                          href='https://github.com/TradingGoose/TradingGoose-Studio'
                          rel='noopener noreferrer'
                          aria-label='GitHub'
                        >
                          <Img
                            src='https://avatars.githubusercontent.com/u/9919'
                            width='24'
                            height='24'
                            alt='GitHub'
                            style={{ borderRadius: '50%' }}
                          />
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td align='center' style={{ paddingTop: '12px' }}>
                <Text
                  style={{
                    ...baseStyles.footerText,
                    fontFamily: baseStyles.fontFamily,
                    color: '#7c8299',
                  }}
                >
                  {emailText(resolvedLocale, copy.footer.copyright, {
                    year,
                    brandName: brand.name,
                  })}
                  <br />
                  {copy.footer.questions}{' '}
                  <a href={`mailto:${brand.supportEmail}`} style={linkStyle}>
                    {brand.supportEmail}
                  </a>
                  {isHosted && (
                    <>
                      <br />
                      {brand.name}, 80 Langton St, San Francisco, CA 94103, USA
                    </>
                  )}
                </Text>
                <table cellPadding={0} cellSpacing={0} style={{ width: '100%', marginTop: '6px' }}>
                  <tbody>
                    <tr>
                      <td align='center'>
                        <p
                          style={{
                            ...baseStyles.footerText,
                            fontFamily: baseStyles.fontFamily,
                          }}
                        >
                          <a href={privacyUrl} style={linkStyle} rel='noopener noreferrer'>
                            {copy.footer.privacy}
                          </a>{' '}
                          |{' '}
                          <a href={termsUrl} style={linkStyle} rel='noopener noreferrer'>
                            {copy.footer.terms}
                          </a>
                          {unsubscribeUrl && (
                            <>
                              {' | '}
                              <Link href={unsubscribeUrl} style={baseStyles.link}>
                                {copy.footer.unsubscribe}
                              </Link>
                            </>
                          )}
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>
    </Container>
  )
}
