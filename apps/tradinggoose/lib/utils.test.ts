import { afterEach, describe, expect, it, vi } from 'vitest'
import { cn, formatDateTime, validateName } from '@/lib/utils'
import { decryptSecret, encryptSecret } from '@/lib/utils-server'

const { createCipherivMock, createDecipherivMock, randomBytesMock } = vi.hoisted(() => {
  const cipherMock = vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('encrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    getAuthTag: vi.fn().mockReturnValue({
      toString: vi.fn().mockReturnValue('auth-tag'),
    }),
  })

  const decipherMock = vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('decrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    setAuthTag: vi.fn(),
  })

  const randomBytes = vi.fn().mockReturnValue({
    toString: vi.fn().mockReturnValue('random-iv'),
  })

  return {
    createCipherivMock: cipherMock,
    createDecipherivMock: decipherMock,
    randomBytesMock: randomBytes,
  }
})

vi.mock('crypto', () => ({
  createCipheriv: createCipherivMock,
  createDecipheriv: createDecipherivMock,
  randomBytes: randomBytesMock,
}))

const { defaultEncryptionKey, mockEnv } = vi.hoisted(() => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  return {
    defaultEncryptionKey: key,
    mockEnv: {
      ENCRYPTION_KEY: key,
    },
  }
})

vi.mock('@/lib/env', () => ({
  env: mockEnv,
}))

afterEach(() => {
  vi.clearAllMocks()
  mockEnv.ENCRYPTION_KEY = defaultEncryptionKey
})

describe('cn (class name utility)', () => {
  it.concurrent('should merge class names correctly', () => {
    const result = cn('class1', 'class2')
    expect(result).toBe('class1 class2')
  })

  it.concurrent('should handle conditional classes', () => {
    const isActive = true
    const result = cn('base', isActive && 'active')
    expect(result).toBe('base active')
  })

  it.concurrent('should handle falsy values', () => {
    const result = cn('base', false && 'hidden', null, undefined, 0, '')
    expect(result).toBe('base')
  })

  it.concurrent('should handle arrays of class names', () => {
    const result = cn('base', ['class1', 'class2'])
    expect(result).toContain('base')
    expect(result).toContain('class1')
    expect(result).toContain('class2')
  })
})

describe('encryption and decryption', () => {
  it.concurrent('should encrypt secrets correctly', async () => {
    const result = await encryptSecret('my-secret')
    expect(result).toHaveProperty('encrypted')
    expect(result).toHaveProperty('iv')
    expect(result.encrypted).toContain('random-iv')
    expect(result.encrypted).toContain('encrypted-data')
    expect(result.encrypted).toContain('final-data')
    expect(result.encrypted).toContain('auth-tag')
  })

  it.concurrent('should decrypt secrets correctly', async () => {
    const result = await decryptSecret('iv:encrypted:authTag')
    expect(result).toHaveProperty('decrypted')
    expect(result.decrypted).toBe('decrypted-datafinal-data')
  })

  it.concurrent('should throw error for invalid decrypt format', async () => {
    await expect(decryptSecret('invalid-format')).rejects.toThrow('Invalid encrypted value format')
  })
})

describe('encryption key compatibility', () => {
  it.concurrent('should support 32-character raw string keys', async () => {
    mockEnv.ENCRYPTION_KEY = 'A'.repeat(32)
    await encryptSecret('raw-secret')

    const keyBuffer = createCipherivMock.mock.calls.at(-1)?.[1]
    expect(Buffer.isBuffer(keyBuffer)).toBe(true)
    expect(keyBuffer?.length).toBe(32)
  })

  it.concurrent('should support base64 encoded keys that decode to 32 bytes', async () => {
    const base64Key = Buffer.from('B'.repeat(32), 'utf8').toString('base64')
    mockEnv.ENCRYPTION_KEY = base64Key

    await encryptSecret('base64-secret')

    const keyBuffer = createCipherivMock.mock.calls.at(-1)?.[1]
    expect(Buffer.isBuffer(keyBuffer)).toBe(true)
    expect(keyBuffer?.length).toBe(32)
  })

  it.concurrent('should reject invalid key lengths', async () => {
    mockEnv.ENCRYPTION_KEY = 'short-key'
    await expect(encryptSecret('secret')).rejects.toThrow(
      'ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)'
    )
  })
})

describe('date formatting functions', () => {
  it.concurrent('should format datetime correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).toMatch(/2:30 PM|14:30/)
  })

  it.concurrent('should format datetime with UTC offset', () => {
    const date = new Date('2023-05-15T14:30:00.000Z')
    const result = formatDateTime(date, '+02:00')
    expect(result).toContain('May 15, 2023')
    expect(result).toContain('4:30 PM')
    expect(result).toContain('UTC+02:00')
  })
})

describe('validateName', () => {
  it.concurrent('should remove invalid characters', () => {
    const result = validateName('test@#$%name')
    expect(result).toBe('testname')
  })

  it.concurrent('should keep valid characters', () => {
    const result = validateName('test_name_123')
    expect(result).toBe('test_name_123')
  })

  it.concurrent('should keep spaces', () => {
    const result = validateName('test name')
    expect(result).toBe('test name')
  })

  it.concurrent('should handle empty string', () => {
    const result = validateName('')
    expect(result).toBe('')
  })

  it.concurrent('should handle string with only invalid characters', () => {
    const result = validateName('@#$%')
    expect(result).toBe('')
  })

  it.concurrent('should handle mixed valid and invalid characters', () => {
    const result = validateName('my-workflow@2023!')
    expect(result).toBe('myworkflow2023')
  })

  it.concurrent('should collapse multiple spaces into single spaces', () => {
    const result = validateName('test    multiple     spaces')
    expect(result).toBe('test multiple spaces')
  })

  it.concurrent('should handle mixed whitespace and invalid characters', () => {
    const result = validateName('test@#$  name')
    expect(result).toBe('test name')
  })
})
