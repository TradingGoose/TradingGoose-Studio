import { describe, expect, it } from 'vitest'
import { quickValidateEmail } from './validation'

describe('quickValidateEmail', () => {
  it.each([
    'user@example.com',
    'test@gmail.com',
    'no-reply@yahoo.com',
    'user12345@outlook.com',
    'longusernamehere@gmail.com',
  ])('accepts legitimate email %s without DNS lookups', (email) => {
    expect(quickValidateEmail(email)).toEqual({ isValid: true })
  })

  it.each([
    ['invalid-email', 'Invalid email format'],
    ['user@', 'Invalid email format'],
    ['user@localhost', 'Invalid domain format'],
    ['test@10minutemail.com', 'Disposable email addresses are not allowed'],
    ['test@tempmail.org', 'Disposable email addresses are not allowed'],
    ['test@TEMPMAIL.ORG', 'Disposable email addresses are not allowed'],
    ['user..name@example.com', 'Email contains suspicious patterns'],
    [`${'a'.repeat(65)}@example.com`, 'Email contains suspicious patterns'],
  ])('rejects %s with its established reason', (email, reason) => {
    expect(quickValidateEmail(email)).toEqual({ isValid: false, reason })
  })
})
