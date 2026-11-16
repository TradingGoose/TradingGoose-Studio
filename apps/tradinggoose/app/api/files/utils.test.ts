import { describe, expect, it } from 'vitest'
import { createFileResponse, findLocalFile } from './utils'

describe('File Serving Security Tests', () => {
  describe('createFileResponse security headers', () => {
    it('should serve safe images inline with proper headers', () => {
      const response = createFileResponse({
        buffer: Buffer.from('fake-image-data'),
        contentType: 'image/png',
        filename: 'safe-image.png',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/png')
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="safe-image.png"')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
      )
    })

    it('should serve PDFs inline safely', () => {
      const response = createFileResponse({
        buffer: Buffer.from('fake-pdf-data'),
        contentType: 'application/pdf',
        filename: 'document.pdf',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/pdf')
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="document.pdf"')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it('should force attachment for HTML files to prevent XSS', () => {
      const response = createFileResponse({
        buffer: Buffer.from('<script>alert("XSS")</script>'),
        contentType: 'text/html',
        filename: 'malicious.html',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="malicious.html"'
      )
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it('should force attachment for SVG files to prevent XSS', () => {
      const response = createFileResponse({
        buffer: Buffer.from(
          '<svg onload="alert(\'XSS\')" xmlns="http://www.w3.org/2000/svg"></svg>'
        ),
        contentType: 'image/svg+xml',
        filename: 'malicious.svg',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="malicious.svg"'
      )
    })

    it('should override dangerous content types to safe alternatives', () => {
      const response = createFileResponse({
        buffer: Buffer.from('<svg>safe content</svg>'),
        contentType: 'image/svg+xml',
        filename: 'image.png', // Extension doesn't match content-type
      })

      expect(response.status).toBe(200)
      // Should override SVG content type to plain text for safety
      expect(response.headers.get('Content-Type')).toBe('text/plain')
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="image.png"')
    })

    it('should force attachment for JavaScript files', () => {
      const response = createFileResponse({
        buffer: Buffer.from('alert("XSS")'),
        contentType: 'application/javascript',
        filename: 'malicious.js',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="malicious.js"'
      )
    })

    it('should force attachment for CSS files', () => {
      const response = createFileResponse({
        buffer: Buffer.from('body { background: url(javascript:alert("XSS")) }'),
        contentType: 'text/css',
        filename: 'malicious.css',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="malicious.css"'
      )
    })

    it('should force attachment for XML files', () => {
      const response = createFileResponse({
        buffer: Buffer.from('<?xml version="1.0"?><root><script>alert("XSS")</script></root>'),
        contentType: 'application/xml',
        filename: 'malicious.xml',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="malicious.xml"'
      )
    })

    it('should serve text files safely', () => {
      const response = createFileResponse({
        buffer: Buffer.from('Safe text content'),
        contentType: 'text/plain',
        filename: 'document.txt',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/plain')
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="document.txt"')
    })

    it('should force attachment for unknown/unsafe content types', () => {
      const response = createFileResponse({
        buffer: Buffer.from('unknown content'),
        contentType: 'application/unknown',
        filename: 'unknown.bin',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/unknown')
      expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="unknown.bin"')
    })
  })

  describe('Content Security Policy', () => {
    it('should include CSP header in all responses', () => {
      const response = createFileResponse({
        buffer: Buffer.from('test'),
        contentType: 'text/plain',
        filename: 'test.txt',
      })

      const csp = response.headers.get('Content-Security-Policy')
      expect(csp).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox;")
    })

    it('should include X-Content-Type-Options header', () => {
      const response = createFileResponse({
        buffer: Buffer.from('test'),
        contentType: 'text/plain',
        filename: 'test.txt',
      })

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    })
  })
})
describe('findLocalFile - Path Traversal Security Tests', () => {
  describe('path traversal attack prevention', () => {
    it.concurrent('should reject classic path traversal attacks', () => {
      const maliciousInputs = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '../../../../etc/shadow',
        '../config.json',
        '..\\config.ini',
      ]

      maliciousInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject encoded path traversal attempts', () => {
      const encodedInputs = [
        '%2e%2e%2f%2e%2e%2f%65%74%63%2f%70%61%73%73%77%64', // ../../../etc/passwd
        '..%2f..%2fetc%2fpasswd',
        '..%5c..%5cconfig.ini',
      ]

      encodedInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject mixed path separators', () => {
      const mixedInputs = ['../..\\config.txt', '..\\../secret.ini', '/..\\..\\system32']

      mixedInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject filenames with dangerous characters', () => {
      const dangerousInputs = [
        'file:with:colons.txt',
        'file|with|pipes.txt',
        'file?with?questions.txt',
        'file*with*asterisks.txt',
      ]

      dangerousInputs.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })

    it.concurrent('should reject null and empty inputs', () => {
      expect(findLocalFile('')).toBeNull()
      expect(findLocalFile('   ')).toBeNull()
      expect(findLocalFile('\t\n')).toBeNull()
    })

    it.concurrent('should reject filenames that become empty after sanitization', () => {
      const emptyAfterSanitization = ['../..', '..\\..\\', '////', '....', '..']

      emptyAfterSanitization.forEach((input) => {
        const result = findLocalFile(input)
        expect(result).toBeNull()
      })
    })
  })

  describe('security validation passes for legitimate files', () => {
    it.concurrent('should accept properly formatted filenames without throwing errors', () => {
      const legitimateInputs = [
        'document.pdf',
        'image.png',
        'data.csv',
        'report-2024.doc',
        'file_with_underscores.txt',
        'file-with-dashes.json',
      ]

      legitimateInputs.forEach((input) => {
        // Should not throw security errors for legitimate filenames
        expect(() => findLocalFile(input)).not.toThrow()
      })
    })
  })
})
