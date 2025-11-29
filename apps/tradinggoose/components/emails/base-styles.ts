import { getBrandConfig } from '@/lib/branding/branding'

// Base styles for all email templates
const brand = getBrandConfig()
const primaryColor = brand.theme?.primaryColor || '#ffcc00'
const backgroundColor = brand.theme?.backgroundColor || '#0b0b0b00'
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const baseStyles = {
  fontFamily,
  main: {
    backgroundColor,
    fontFamily,
    padding: '24px 0',
  },
  container: {
    maxWidth: '420px',
    width: '100%',
    margin: '0 auto',
    backgroundColor: '#202020',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
    border: '1px solid #11121800',
    padding: '32px 28px 28px 28px',
  },
  header: {
    textAlign: 'center' as const,
    paddingBottom: '8px',
  },
  brandStack: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    marginBottom: '6px',
  },
  logo: {
    width: '60px',
    height: '60px',
    borderRadius: '14px',
    objectFit: 'cover' as const,
  },
  brandName: {
    color: primaryColor,
    fontSize: '28px',
    fontWeight: 800,
    letterSpacing: '-0.01em',
  },
  tagline: {
    color: '#939eae',
    fontSize: '14px',
    fontWeight: 600,
    margin: '0',
    textAlign: 'center' as const,
  },
  content: {
    padding: '4px 0 0 0',
  },
  title: {
    fontSize: '22px',
    lineHeight: '1.4',
    color: '#cfd5e5',
    fontWeight: 600,
    margin: '12px 0',
    textAlign: 'center' as const,
  },
  paragraph: {
    fontSize: '15px',
    lineHeight: '1.6',
    color: '#c5cbd8',
    margin: '12px 0',
    textAlign: 'center' as const,
  },
  button: {
    display: 'inline-block',
    backgroundColor: primaryColor,
    color: '#000000',
    fontWeight: 800,
    fontSize: '15px',
    padding: '12px 24px',
    borderRadius: '20px',
    textDecoration: 'none',
    textAlign: 'center' as const,
    margin: '22px auto',
  },
  link: {
    color: primaryColor,
    textDecoration: 'underline',
  },
  footer: {
    maxWidth: '420px',
    margin: '12px auto 0 auto',
    padding: '12px 0',
    textAlign: 'center' as const,
  },
  footerText: {
    fontSize: '12px',
    color: '#7c8299',
    margin: '0',
    lineHeight: '1.5',
    textAlign: 'center' as const,
  },
  codeContainer: {
    margin: '16px 0',
    padding: '16px',
    backgroundColor: '#0f1014',
    borderRadius: '10px',
    border: '1px solid #1d1e26',
    textAlign: 'center' as const,
  },
  code: {
    fontSize: '28px',
    fontWeight: 800,
    letterSpacing: '4px',
    color: primaryColor,
  },
  sectionsBorders: {
    width: '100%',
    display: 'flex',
    padding: '8px 0 4px',
  },
  sectionBorder: {
    borderBottom: '1px solid #1f202a',
    width: '100%',
  },
  sectionCenter: {
    borderBottom: `1px solid ${primaryColor}`,
    width: '88px',
  },
  divider: {
    borderTop: '1px solid #1f202a',
    margin: '18px 0',
  },
}
