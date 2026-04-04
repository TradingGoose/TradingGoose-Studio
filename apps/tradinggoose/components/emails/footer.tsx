import * as React from 'react'
import { Container, Img, Link, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import { getBrandConfig } from '@/lib/branding/branding'
import { isHosted } from '@/lib/environment'
import { getBaseUrl } from '@/lib/urls/utils'

interface UnsubscribeOptions {
  unsubscribeToken?: string
  email?: string
}

interface EmailFooterProps {
  baseUrl?: string
  unsubscribe?: UnsubscribeOptions
}

export const EmailFooter = ({ baseUrl = getBaseUrl(), unsubscribe }: EmailFooterProps) => {
  const brand = getBrandConfig()

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
                        <Link href='https://discord.gg/wavf5JWhuT' rel='noopener noreferrer'>
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
                        <Link href='https://github.com/TradingGoose/TradingGoose-Studio' rel='noopener noreferrer'>
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
                  (c) {new Date().getFullYear()} {brand.name}, All Rights Reserved
                  <br />
                  Questions? Email{' '}
                  <a
                    href={`mailto:${brand.supportEmail}`}
                    style={{
                      color: baseStyles.link.color,
                      textDecoration: 'underline',
                      fontWeight: 600,
                      fontFamily: baseStyles.fontFamily,
                    }}
                  >
                    {brand.supportEmail}
                  </a>
                  {isHosted && (
                    <>
                      <br />
                      {brand.name}, 80 Langton St, San Francisco, CA 94103, USA
                    </>
                  )}
                </Text>
                <table
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ width: '100%', marginTop: '6px' }}
                >
                  <tbody>
                    <tr>
                      <td align='center'>
                        <p
                          style={{
                            ...baseStyles.footerText,
                            fontFamily: baseStyles.fontFamily,
                          }}
                        >
                          <a
                            href={`${baseUrl}/privacy`}
                            style={{
                              color: baseStyles.link.color,
                              textDecoration: 'underline',
                              fontWeight: 600,
                              fontFamily: baseStyles.fontFamily,
                            }}
                            rel='noopener noreferrer'
                          >
                            Privacy Policy
                          </a>{' '}
                          |{' '}
                          <a
                            href={`${baseUrl}/terms`}
                            style={{
                              color: baseStyles.link.color,
                              textDecoration: 'underline',
                              fontWeight: 600,
                              fontFamily: baseStyles.fontFamily,
                            }}
                            rel='noopener noreferrer'
                          >
                            Terms of Service
                          </a>{' '}
                          |{' '}
                          <a
                            href={
                              unsubscribe?.unsubscribeToken && unsubscribe?.email
                                ? `${baseUrl}/unsubscribe?token=${unsubscribe.unsubscribeToken}&email=${encodeURIComponent(unsubscribe.email)}`
                                : '{{{RESEND_UNSUBSCRIBE_URL}}}'
                            }
                            style={{
                              color: baseStyles.link.color,
                              textDecoration: 'underline',
                              fontWeight: 600,
                              fontFamily: baseStyles.fontFamily,
                            }}
                            rel='noopener noreferrer'
                          >
                            Unsubscribe
                          </a>
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

export default EmailFooter
