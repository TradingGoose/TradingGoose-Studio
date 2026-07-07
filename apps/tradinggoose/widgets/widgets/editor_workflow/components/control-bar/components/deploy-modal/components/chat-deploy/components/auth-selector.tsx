import { useState } from 'react'
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button, Card, CardContent, Input, Label } from '@/components/ui'
import type { ChatAuthType } from '@/lib/chat/deployment-config'
import { getEnv, isTruthy } from '@/lib/env'
import { cn, generatePassword } from '@/lib/utils'
import { formatTemplate } from '@/i18n/utils'
import { useDeploymentCopy } from '@/widgets/widgets/editor_workflow/copy'

interface AuthSelectorProps {
  authType: ChatAuthType
  password: string
  emails: string[]
  onAuthTypeChange: (type: ChatAuthType) => void
  onPasswordChange: (password: string) => void
  onEmailsChange: (emails: string[]) => void
  disabled?: boolean
  isExistingChat?: boolean
  error?: string
}

export function AuthSelector({
  authType,
  password,
  emails,
  onAuthTypeChange,
  onPasswordChange,
  onEmailsChange,
  disabled = false,
  isExistingChat = false,
  error,
}: AuthSelectorProps) {
  const copy = useDeploymentCopy().chat.auth
  const [showPassword, setShowPassword] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)

  const handleGeneratePassword = () => {
    const password = generatePassword(24)
    onPasswordChange(password)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleAddEmail = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) && !newEmail.startsWith('@')) {
      setEmailError(copy.invalidEmailOrDomain)
      return
    }

    if (emails.includes(newEmail)) {
      setEmailError(copy.duplicateEmailOrDomain)
      return
    }

    onEmailsChange([...emails, newEmail])
    setNewEmail('')
    setEmailError('')
  }

  const handleRemoveEmail = (email: string) => {
    onEmailsChange(emails.filter((e) => e !== email))
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const authOptions = ssoEnabled
    ? (['public', 'password', 'email', 'sso'] as const)
    : (['public', 'password', 'email'] as const)
  const getAccessTypeLabel = (type: ChatAuthType) => {
    if (type === 'public') return copy.publicAccess
    if (type === 'password') return copy.passwordProtected
    if (type === 'email') return copy.emailAccess
    return copy.ssoAccess
  }

  return (
    <div className='space-y-2'>
      <Label className='font-medium text-sm'>{copy.accessControl}</Label>

      {/* Auth Type Selection */}
      <div
        className={cn('grid grid-cols-1 gap-3', ssoEnabled ? 'md:grid-cols-4' : 'md:grid-cols-3')}
      >
        {authOptions.map((type) => (
          <Card
            key={type}
            className={cn(
              'cursor-pointer overflow-hidden rounded-sm shadow-none transition-all duration-200 hover:bg-card/30',
              authType === type
                ? 'border border-muted-foreground hover:bg-card'
                : 'border border-input'
            )}
          >
            <CardContent className='relative flex flex-col items-center justify-center p-4 text-center'>
              <button
                type='button'
                className='absolute inset-0 z-10 h-full w-full cursor-pointer'
                onClick={() => !disabled && onAuthTypeChange(type)}
                aria-label={formatTemplate(copy.selectAccessAriaLabel, {
                  type: getAccessTypeLabel(type),
                })}
                disabled={disabled}
              />
              <div className='justify-center text-center align-middle'>
                <h3 className='font-medium text-sm'>{getAccessTypeLabel(type)}</h3>
                <p className='text-muted-foreground text-xs'>
                  {type === 'public' && copy.publicAccessDescription}
                  {type === 'password' && copy.passwordProtectedDescription}
                  {type === 'email' && copy.emailAccessDescription}
                  {type === 'sso' && copy.ssoAccessDescription}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Auth Settings */}
      {authType === 'password' && (
        <Card className='rounded-sm shadow-none'>
          <CardContent className='p-4'>
            <h3 className='mb-2 font-medium text-sm'>{copy.passwordSettings}</h3>

            {isExistingChat && !password && (
              <div className='mb-2 flex items-center text-muted-foreground text-xs'>
                <div className='mr-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 font-medium text-muted-foreground'>
                  {copy.passwordSet}
                </div>
                <span>{copy.currentPasswordStored}</span>
              </div>
            )}

            <div className='relative'>
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder={isExistingChat ? copy.enterNewPasswordKeepCurrent : copy.enterPassword}
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                disabled={disabled}
                className='h-10 rounded-sm pr-32'
                required={!isExistingChat}
                autoComplete='new-password'
              />
              <div className='absolute top-0.5 right-0.5 flex h-9 items-center gap-1 pr-1'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={handleGeneratePassword}
                  disabled={disabled}
                  className={cn(
                    'group h-7 w-7 rounded-md p-0',
                    'text-muted-foreground/60 transition-all duration-200',
                    'hover:bg-card/50 hover:text-foreground',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                  )}
                >
                  <RefreshCw className='h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-90' />
                  <span className='sr-only'>{copy.generatePassword}</span>
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => copyToClipboard(password)}
                  disabled={!password || disabled}
                  className={cn(
                    'group h-7 w-7 rounded-md p-0',
                    'text-muted-foreground/60 transition-all duration-200',
                    'hover:bg-card/50 hover:text-foreground',
                    'disabled:cursor-not-allowed disabled:opacity-30',
                    'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                  )}
                >
                  {copySuccess ? (
                    <Check className='h-3.5 w-3.5 text-foreground' />
                  ) : (
                    <Copy className='h-3.5 w-3.5 ' />
                  )}
                  <span className='sr-only'>{copy.copyPassword}</span>
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={disabled}
                  className={cn(
                    'group h-7 w-7 rounded-md p-0',
                    'text-muted-foreground/60 transition-all duration-200',
                    'hover:bg-card/50 hover:text-foreground',
                    'focus-visible:ring-2 focus-visible:ring-muted-foreground/20 focus-visible:ring-offset-1'
                  )}
                >
                  {showPassword ? (
                    <EyeOff className='h-3.5 w-3.5 ' />
                  ) : (
                    <Eye className='h-3.5 w-3.5 ' />
                  )}
                  <span className='sr-only'>
                    {showPassword ? copy.hidePassword : copy.showPassword}
                  </span>
                </Button>
              </div>
            </div>

            <p className='mt-2 text-muted-foreground text-xs'>
              {isExistingChat
                ? copy.keepCurrentPasswordDescription
                : copy.passwordAccessDescription}
            </p>
          </CardContent>
        </Card>
      )}

      {(authType === 'email' || authType === 'sso') && (
        <Card className='rounded-sm shadow-none'>
          <CardContent className='p-4'>
            <h3 className='mb-2 font-medium text-sm'>
              {authType === 'email' ? copy.emailAccessSettings : copy.ssoAccessSettings}
            </h3>

            <div className='flex gap-2'>
              <Input
                placeholder={copy.emailOrDomainPlaceholder}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={disabled}
                className='h-10 flex-1 rounded-sm'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddEmail()
                  }
                }}
              />
              <Button
                type='button'
                onClick={handleAddEmail}
                disabled={!newEmail.trim() || disabled}
                className='h-10 shrink-0 rounded-sm'
              >
                <Plus className='h-4 w-4' />
                {copy.add}
              </Button>
            </div>

            {emailError && <p className='mt-1 text-destructive text-sm'>{emailError}</p>}

            {emails.length > 0 && (
              <div className='mt-3 max-h-[150px] overflow-y-auto rounded-md border bg-background px-2 py-0 shadow-none'>
                <ul className='divide-y divide-border'>
                  {emails.map((email) => (
                    <li key={email} className='relative'>
                      <div className='group my-1 flex items-center justify-between rounded-sm px-2 py-2 text-sm'>
                        <span className='font-medium text-foreground'>{email}</span>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          onClick={() => handleRemoveEmail(email)}
                          disabled={disabled}
                          className='h-7 w-7 opacity-70'
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className='mt-2 text-muted-foreground text-xs'>
              {authType === 'email' ? copy.emailAccessHelp : copy.ssoAccessHelp}
            </p>
          </CardContent>
        </Card>
      )}

      {authType === 'public' && (
        <Card className='rounded-sm shadow-none'>
          <CardContent className='p-4'>
            <h3 className='mb-2 font-medium text-sm'>{copy.publicAccessSettings}</h3>
            <p className='text-muted-foreground text-xs'>{copy.publicAccessHelp}</p>
          </CardContent>
        </Card>
      )}

      {error && <p className='text-destructive text-sm'>{error}</p>}
    </div>
  )
}
