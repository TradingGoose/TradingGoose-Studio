'use client'

import { type KeyboardEvent, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('PasswordAuth')

interface PasswordAuthProps {
  identifier: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
}

export default function PasswordAuth({
  identifier,
  onAuthSuccess,
  title = 'chat',
  primaryColor = 'var(--primary-hover)',
}: PasswordAuthProps) {
  // Password auth state
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showValidationError, setShowValidationError] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  // Handle keyboard input for auth forms
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    setShowValidationError(false)
    setPasswordErrors([])
  }

  // Handle authentication
  const handleAuthenticate = async () => {
    if (!password.trim()) {
      setPasswordErrors(['Password is required'])
      setShowValidationError(true)
      return
    }

    setAuthError(null)
    setIsAuthenticating(true)

    try {
      const payload = { password }

      const response = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setPasswordErrors([errorData.error || 'Invalid password. Please try again.'])
        setShowValidationError(true)
        return
      }

      // Authentication successful, notify parent
      onAuthSuccess()

      // Reset auth state
      setPassword('')
    } catch (error) {
      logger.error('Authentication error:', error)
      setPasswordErrors(['An error occurred during authentication'])
      setShowValidationError(true)
    } finally {
      setIsAuthenticating(false)
    }
  }

  return (
    <div className=' '>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Header */}
            <div className='space-y-1 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[32px] tracking-tight`}
              >
                Password Required
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                This chat is password-protected
              </p>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleAuthenticate()
              }}
              className={`${inter.className} mt-8 w-full space-y-8`}
            >
              <div className='space-y-6'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='password'>Password</Label>
                  </div>
                  <div className='relative'>
                    <Input
                      id='password'
                      name='password'
                      required
                      type={showPassword ? 'text' : 'password'}
                      autoCapitalize='none'
                      autoComplete='new-password'
                      autoCorrect='off'
                      placeholder='Enter password'
                      value={password}
                      onChange={handlePasswordChange}
                      onKeyDown={handleKeyDown}
                      className={cn(
                        'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                        showValidationError &&
                        passwordErrors.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                      )}
                      autoFocus
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {showValidationError && passwordErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {passwordErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <Button type='submit' className={primaryButtonClasses} disabled={isAuthenticating}>
                {isAuthenticating ? 'Authenticating...' : 'Continue'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
