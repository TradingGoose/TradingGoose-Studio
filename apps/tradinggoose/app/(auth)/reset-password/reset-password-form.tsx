'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter'

const primaryButtonClasses =
  'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'
const MIN_PASSWORD_LENGTH = 8

interface SetNewPasswordFormProps {
  token: string | null
  onSubmit: (password: string) => Promise<void>
  isSubmitting: boolean
  result: {
    type: 'success' | 'error'
    message: string
  } | null
  className?: string
}

export function SetNewPasswordForm({
  token,
  onSubmit,
  isSubmitting,
  result,
  className,
}: SetNewPasswordFormProps) {
  const copy = useMessages().auth.resetPassword
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationMessage(copy.setNew.validation.passwordTooShort)
      return
    }

    if (password !== confirmPassword) {
      setValidationMessage(copy.setNew.validation.passwordMismatch)
      return
    }

    setValidationMessage('')
    onSubmit(password)
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={isSubmitting}
      className={cn(`${inter.className} space-y-8`, className)}
    >
      <div className='space-y-6'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='password'>{copy.setNew.passwordLabel}</Label>
          </div>
          <div className='relative'>
            <Input
              id='password'
              type={showPassword ? 'text' : 'password'}
              autoCapitalize='none'
              autoComplete='new-password'
              autoCorrect='off'
              minLength={MIN_PASSWORD_LENGTH}
              disabled={isSubmitting || !token}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={validationMessage ? 'reset-password-error' : undefined}
              required
              placeholder={copy.setNew.passwordPlaceholder}
              className={cn(
                'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                validationMessage &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
              aria-label={showPassword ? copy.setNew.hidePassword : copy.setNew.showPassword}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='confirmPassword'>{copy.setNew.confirmPasswordLabel}</Label>
          </div>
          <div className='relative'>
            <Input
              id='confirmPassword'
              type={showConfirmPassword ? 'text' : 'password'}
              autoCapitalize='none'
              autoComplete='new-password'
              autoCorrect='off'
              disabled={isSubmitting || !token}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(validationMessage)}
              aria-describedby={validationMessage ? 'reset-password-error' : undefined}
              required
              placeholder={copy.setNew.confirmPasswordPlaceholder}
              className={cn(
                'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                validationMessage &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <button
              type='button'
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
              aria-label={showConfirmPassword ? copy.setNew.hidePassword : copy.setNew.showPassword}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {validationMessage && (
          <div
            id='reset-password-error'
            role='alert'
            className='mt-1 space-y-1 text-red-400 text-xs'
          >
            <p>{validationMessage}</p>
          </div>
        )}

        {result ? (
          <div
            role={result.type === 'error' ? 'alert' : 'status'}
            aria-live={result.type === 'success' ? 'polite' : undefined}
            className={cn(
              'mt-1 space-y-1 text-xs',
              result.type === 'success' ? 'text-[#4CAF50]' : 'text-red-400'
            )}
          >
            <p>{result.message}</p>
          </div>
        ) : null}
      </div>

      <Button
        disabled={isSubmitting || !token}
        type='submit'
        aria-busy={isSubmitting}
        className={primaryButtonClasses}
      >
        {isSubmitting ? copy.setNew.submitting : copy.setNew.submit}
      </Button>
    </form>
  )
}
