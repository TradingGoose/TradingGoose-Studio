import * as React from 'react'
import { Body, Container, Head, Html, Link, Preview, Section, Text } from '@react-email/components'
import { baseStyles } from '@/components/emails/base-styles'
import EmailFooter from '@/components/emails/footer'
import EmailHeader from '@/components/emails/header'
import { getBaseUrl } from '@/lib/urls/utils'
import {
  type EmailLocale,
  getEmailCopy,
  normalizeEmailTemplateLocale,
} from '@/components/emails/email-copy'

interface LocalizedEmailProps {
  locale?: EmailLocale
  preview: string
  title: string
  paragraphs: string[]
  cta?: {
    href: string
    label: string
  }
  code?: string
  detailsTitle?: string
  details?: string[]
  muted?: string[]
  footerLine?: string
  baseUrl?: string
}

export function LocalizedEmail({
  locale,
  preview,
  title,
  paragraphs,
  cta,
  code,
  detailsTitle,
  details = [],
  muted = [],
  footerLine,
  baseUrl = getBaseUrl(),
}: LocalizedEmailProps) {
  const resolvedLocale = normalizeEmailTemplateLocale(locale)
  const copy = getEmailCopy(resolvedLocale)

  return (
    <Html>
      <Head />
      <Body style={baseStyles.main}>
        <Preview>{preview}</Preview>
        <Container style={baseStyles.container}>
          <EmailHeader baseUrl={baseUrl} locale={resolvedLocale} tagline={copy.shared.tagline} />

          <Section style={baseStyles.content}>
            <Text style={baseStyles.title}>{title}</Text>
            {paragraphs.map((paragraph) => (
              <Text key={paragraph} style={baseStyles.paragraph}>
                {paragraph}
              </Text>
            ))}

            {code ? (
              <Section style={baseStyles.codeContainer}>
                <Text style={baseStyles.code}>{code}</Text>
              </Section>
            ) : null}

            {detailsTitle || details.length > 0 ? (
              <Section style={baseStyles.codeContainer}>
                {detailsTitle ? (
                  <Text style={{ ...baseStyles.paragraph, marginTop: 0, fontWeight: 'bold' }}>
                    {detailsTitle}
                  </Text>
                ) : null}
                {details.map((detail) => (
                  <Text
                    key={detail}
                    style={{ ...baseStyles.paragraph, margin: '6px 0', textAlign: 'left' }}
                  >
                    {detail}
                  </Text>
                ))}
              </Section>
            ) : null}

            {cta ? (
              <Section>
                <table role='presentation' width='100%'>
                  <tbody>
                    <tr>
                      <td align='center'>
                        <Link href={cta.href} style={{ textDecoration: 'none' }}>
                          <Text style={{ ...baseStyles.button, display: 'inline-block', margin: '22px 0' }}>
                            {cta.label}
                          </Text>
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Section>
            ) : null}

            {muted.length > 0 ? <Section style={baseStyles.divider} /> : null}
            {muted.map((paragraph) => (
              <Text
                key={paragraph}
                style={{ ...baseStyles.paragraph, fontSize: '14px', color: '#929eae' }}
              >
                {paragraph}
              </Text>
            ))}

            {footerLine ? (
              <Text
                style={{
                  ...baseStyles.footerText,
                  marginTop: '18px',
                  fontFamily: baseStyles.fontFamily,
                }}
              >
                {footerLine}
              </Text>
            ) : null}
          </Section>
        </Container>

        <EmailFooter baseUrl={baseUrl} locale={resolvedLocale} />
      </Body>
    </Html>
  )
}
