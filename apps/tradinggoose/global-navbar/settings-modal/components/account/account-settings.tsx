'use client'

import { type DragEvent, type FormEvent, useRef, useState } from 'react'
import { AlertCircle, Check, Info, Loader2, Pencil, X } from 'lucide-react'
import Image from 'next/image'
import { useMessages, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getUsernameErrorMessage } from '@/lib/auth/auth-error-copy'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { client, useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { IMAGE_UPLOAD_MIME_TYPES } from '@/lib/uploads/client/image-upload'
import { useProfilePictureUpload } from '@/global-navbar/settings-modal/components/hooks/use-profile-picture-upload'
import { usernameInputProps, useUsernameAvailability } from '@/hooks/queries/username'
import { useGeneralStore } from '@/stores/settings/general/store'
import { ChangeEmailForm } from './change-email-form'

const logger = createLogger('AccountSettings')
const DEFAULT_AVATAR_SRC = '/profile/avatar.png'
type SessionUser = NonNullable<ReturnType<typeof useSession>['data']>['user']

export function AccountSettings() {
  const { data: session } = useSession()
  return <AccountSettingsForm key={session?.user?.id} sessionUser={session?.user} />
}

function AccountSettingsForm({ sessionUser }: { sessionUser?: SessionUser }) {
  const authRedirectUrls = useAuthRedirectUrls()
  const tAccount = useTranslations('workspace.settingsModal.account')
  const usernameCopy = useMessages().username
  const userId = sessionUser?.id ?? null
  const sessionEmail = sessionUser?.email ?? ''
  const [confirmedProfile, setConfirmedProfile] = useState<{
    name?: string
    email?: { previous: string; value: string }
    image?: string
    displayUsername?: string
  }>({})
  const pending = { ...confirmedProfile }
  const fields = Object.keys(confirmedProfile) as (keyof typeof confirmedProfile)[]
  for (const field of fields) {
    const acknowledged =
      field === 'email'
        ? sessionEmail && sessionEmail !== pending.email?.previous
        : pending[field] === sessionUser?.[field]
    if (acknowledged) delete pending[field]
  }
  if (Object.keys(pending).length !== fields.length) setConfirmedProfile(pending)
  const name = confirmedProfile.name ?? sessionUser?.name ?? ''
  const email = confirmedProfile.email?.value ?? sessionEmail
  const userImage = confirmedProfile.image ?? sessionUser?.image ?? null
  const username =
    confirmedProfile.displayUsername ?? sessionUser?.displayUsername ?? sessionUser?.username ?? ''
  const confirmProfile = (values: typeof confirmedProfile) => {
    setConfirmedProfile((previous) => ({ ...previous, ...values }))
  }

  // Telemetry state from general store
  const isTelemetrySettingsLoading = useGeneralStore((state) => state.isLoading)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)
  const isTelemetryLoading = useGeneralStore((state) => state.isTelemetryLoading)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)

  const handleTelemetryToggle = (checked: boolean) => {
    if (checked === telemetryEnabled || isTelemetryLoading) {
      return
    }

    void setTelemetryEnabled(checked)

    if (checked && typeof window !== 'undefined') {
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'consent',
          action: 'enable_from_settings',
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {
        // Silently fail - this is just telemetry
      })
    }
  }

  const [profilePictureError, setProfilePictureError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [passwordResetStatus, setPasswordResetStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [isUpdatingName, setIsUpdatingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [editingUsername, setUsernameEdit] = useState<{
    value: string
    valid: boolean
    pending?: boolean
    error?: string
  } | null>(null)
  const usernameAvailability = useUsernameAvailability(
    editingUsername?.valid ? editingUsername.value : '',
    username
  )
  const usernameError =
    editingUsername?.error ?? (usernameAvailability === 'taken' ? usernameCopy.taken : null)
  const usernameStatus =
    usernameAvailability === 'idle' || usernameAvailability === 'taken'
      ? null
      : usernameCopy[usernameAvailability]
  const usernameSavePending = useRef(false)

  const editNameInputRef = useRef<HTMLInputElement>(null)
  const nameEditActionRef = useRef<'save' | null>(null)

  const commitEditingUsername = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      !userId ||
      !editingUsername ||
      usernameSavePending.current ||
      usernameAvailability === 'taken'
    )
      return
    const value = editingUsername.value.trim()
    if (!value) {
      setUsernameEdit({ ...editingUsername, error: usernameCopy.required })
      return
    }
    usernameSavePending.current = true
    setUsernameEdit({ ...editingUsername, value, pending: true, error: undefined })
    try {
      const result = await client.updateUser({ username: value, displayUsername: value })
      if (result.error) throw result.error
      confirmProfile({ displayUsername: value })
      setUsernameEdit(null)
    } catch (cause) {
      const error =
        getUsernameErrorMessage(usernameCopy, (cause as { code?: string })?.code) ??
        tAccount('status.usernameUpdateError')
      setUsernameEdit({ value, valid: editingUsername.valid, error })
    } finally {
      usernameSavePending.current = false
    }
  }

  const updateUserImage = async (imageUrl: string) => {
    if (!userId) return
    const result = await client.updateUser({ image: imageUrl })
    if (result.error) throw new Error(tAccount('status.profilePictureUpdateError'))
    confirmProfile({ image: imageUrl })
    setProfilePictureError(null)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const { previewUrl, upload, isUploading } = useProfilePictureUpload({
    messages: {
      fileTooLarge: (fileName) => tAccount('status.profilePictureFileTooLarge', { name: fileName }),
      unsupportedFormat: (fileName) =>
        tAccount('status.profilePictureUnsupportedFormat', { name: fileName }),
      uploadFailed: tAccount('status.unableToUpdateProfilePicture'),
    },
    currentImage: userImage,
    onUpload: updateUserImage,
    onError: setProfilePictureError,
  })

  const startEditingName = () => {
    setEditingNameValue(name)
    setIsEditingName(true)
    setNameError(null)
    setTimeout(() => {
      editNameInputRef.current?.focus()
      editNameInputRef.current?.select()
    }, 0)
  }

  const cancelEditingName = () => {
    setIsEditingName(false)
    setEditingNameValue('')
    setNameError(null)
  }

  const commitEditingName = async () => {
    if (!userId || isUpdatingName) return
    const trimmedName = editingNameValue.trim()
    if (!trimmedName) {
      setNameError(tAccount('status.nameRequiredValidation'))
      editNameInputRef.current?.focus()
      return
    }
    if (trimmedName === name) {
      setIsEditingName(false)
      setNameError(null)
      return
    }

    setIsUpdatingName(true)
    setNameError(null)
    try {
      const result = await client.updateUser({ name: trimmedName })
      if (result.error) throw result.error
      confirmProfile({ name: trimmedName })
      setIsEditingName(false)
    } catch (error) {
      logger.error('Error updating name:', error)
      setNameError(tAccount('status.unableToUpdateName'))
      editNameInputRef.current?.focus()
    } finally {
      setIsUpdatingName(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setPasswordResetStatus({
        type: 'error',
        message: tAccount('status.noEmail'),
      })
      return
    }

    setIsSendingReset(true)
    setPasswordResetStatus(null)
    try {
      const result = await client.requestPasswordReset({
        email,
        redirectTo: authRedirectUrls.passwordResetUrl(),
      })
      if (result.error) throw new Error(tAccount('status.passwordResetFailed'))

      setPasswordResetStatus({
        type: 'success',
        message: tAccount('status.passwordResetSent'),
      })
    } catch (error) {
      logger.error('Error requesting password reset:', error)
      setPasswordResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : tAccount('status.passwordResetFailed'),
      })
    } finally {
      setIsSendingReset(false)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const nextTarget = event.relatedTarget as Node | null
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setIsDragActive(false)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)

    void upload(event.dataTransfer.files[0])
  }

  const avatarSrc = previewUrl || userImage || DEFAULT_AVATAR_SRC

  return (
    <div className='bg-background px-6 py-6'>
      <div className='grid gap-6 p-6 sm:grid-cols-[280px,1fr] '>
        <Card className='border-none shadow-none'>
          <CardHeader className='pb-4'>
            <CardTitle className='font-semibold text-base'>{tAccount('profilePicture')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div
              className={`group relative flex flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed px-4 py-6 text-center transition-all ${
                isDragActive
                  ? 'border-primary bg-primary/10'
                  : 'border-muted-foreground/35 bg-card hover:border-primary/40 hover:bg-muted/70'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Input
                type='file'
                accept={IMAGE_UPLOAD_MIME_TYPES.join(',')}
                className='hidden'
                ref={fileInputRef}
                onChange={(event) => void upload(event.target.files?.[0])}
                disabled={isUploading}
              />
              <div className='relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border bg-muted shadow-sm'>
                <Image
                  src={avatarSrc}
                  alt={name || tAccount('profilePictureAlt')}
                  width={96}
                  height={96}
                  className='h-full w-full object-cover'
                />
                {isUploading && (
                  <div className='absolute inset-0 flex items-center justify-center rounded-md bg-black/40 text-white'>
                    <Loader2 className='h-5 w-5 animate-spin' />
                  </div>
                )}
              </div>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>{tAccount('dropImage')}</p>
                <p className='text-muted-foreground text-xs'>{tAccount('imageHint')}</p>
              </div>
            </div>

            {profilePictureError && (
              <div className='flex items-start gap-2 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs'>
                <AlertCircle className='mt-0.5 h-4 w-4 flex-none' />
                <span>{profilePictureError}</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className='border-none shadow-none'>
          <CardHeader className='space-y-1 pb-5'>
            <CardTitle className='font-semibold text-lg'>{tAccount('profileDetails')}</CardTitle>
            <p className='text-muted-foreground text-sm'>{tAccount('profileDetailsDescription')}</p>
          </CardHeader>
          <CardContent className='space-y-5'>
            <div className='space-y-3'>
              <div className='space-y-1'>
                <Label htmlFor='accountName'>{tAccount('fullName')}</Label>
                {isEditingName ? (
                  <div className='py-1.5'>
                    <div className='flex max-w-md items-center gap-2'>
                      <Input
                        id='accountName'
                        ref={editNameInputRef}
                        value={editingNameValue}
                        onChange={(event) => setEditingNameValue(event.target.value)}
                        onBlur={() => {
                          if (nameEditActionRef.current === 'save') {
                            return
                          }
                          cancelEditingName()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void commitEditingName()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelEditingName()
                          }
                        }}
                        disabled={isUpdatingName}
                        className='h-8 min-w-0 flex-1'
                        autoComplete='off'
                      />
                      <button
                        type='button'
                        onMouseDown={() => {
                          nameEditActionRef.current = 'save'
                        }}
                        className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                        onClick={() => {
                          nameEditActionRef.current = null
                          void commitEditingName()
                        }}
                        disabled={isUpdatingName}
                      >
                        <Check className='h-3.5 w-3.5' />
                        <span className='sr-only'>{tAccount('saveName')}</span>
                      </button>
                      <button
                        type='button'
                        onMouseDown={() => {
                          nameEditActionRef.current = null
                        }}
                        className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                        onClick={cancelEditingName}
                        disabled={isUpdatingName}
                      >
                        <X className='h-3.5 w-3.5' />
                        <span className='sr-only'>{tAccount('cancelEditingName')}</span>
                      </button>
                    </div>
                    {nameError && <p className='text-destructive text-xs'>{nameError}</p>}
                  </div>
                ) : (
                  <div className='flex items-center gap-2'>
                    <p className='font-medium'>{name || '—'}</p>
                    <button
                      type='button'
                      className='inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                      onClick={startEditingName}
                      disabled={isUpdatingName}
                    >
                      <Pencil className='h-3.5 w-3.5' />
                      <span className='sr-only'>{tAccount('editName')}</span>
                    </button>
                  </div>
                )}
              </div>
              <div className='space-y-1'>
                <Label htmlFor='accountUsername'>{tAccount('username')}</Label>
                {editingUsername ? (
                  <form onSubmit={commitEditingUsername} className='space-y-1 py-1.5'>
                    <div className='flex max-w-md items-center gap-2'>
                      <Input
                        id='accountUsername'
                        value={editingUsername.value}
                        onChange={(event) =>
                          setUsernameEdit({
                            ...editingUsername,
                            value: event.target.value,
                            valid: event.currentTarget.validity.valid,
                            error: undefined,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && !editingUsername.pending) {
                            event.preventDefault()
                            setUsernameEdit(null)
                          }
                        }}
                        {...usernameInputProps}
                        title={tAccount('usernameHint')}
                        disabled={editingUsername.pending}
                        aria-invalid={Boolean(usernameError)}
                        aria-describedby={
                          usernameError || usernameStatus
                            ? 'account-username-hint account-username-status'
                            : 'account-username-hint'
                        }
                        className='h-8 min-w-0 flex-1'
                      />
                      <Button
                        type='submit'
                        variant='ghost'
                        size='icon'
                        className='h-7 w-7'
                        disabled={editingUsername.pending || usernameAvailability === 'taken'}
                      >
                        <Check className='h-3.5 w-3.5' />
                        <span className='sr-only'>{tAccount('saveUsername')}</span>
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='h-7 w-7'
                        onClick={() => setUsernameEdit(null)}
                        disabled={editingUsername.pending}
                      >
                        <X className='h-3.5 w-3.5' />
                        <span className='sr-only'>{tAccount('cancelEditingUsername')}</span>
                      </Button>
                    </div>
                    {(usernameError || usernameStatus) && (
                      <p
                        id='account-username-status'
                        role={usernameError ? 'alert' : 'status'}
                        aria-live='polite'
                        className={
                          usernameError
                            ? 'text-destructive text-xs'
                            : 'text-muted-foreground text-xs'
                        }
                      >
                        {usernameError ?? usernameStatus}
                      </p>
                    )}
                  </form>
                ) : (
                  <div className='flex items-center gap-2'>
                    <p className='font-medium'>{username || '—'}</p>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7'
                      disabled={!userId}
                      onClick={() =>
                        userId && setUsernameEdit({ value: username, valid: Boolean(username) })
                      }
                    >
                      <Pencil className='h-3.5 w-3.5' />
                      <span className='sr-only'>{tAccount('editUsername')}</span>
                    </Button>
                  </div>
                )}
                <p id='account-username-hint' className='text-muted-foreground text-xs'>
                  {tAccount('usernameHint')}
                </p>
              </div>
              <div className='space-y-1'>
                <Label>{tAccount('emailAddress')}</Label>
                <ChangeEmailForm
                  email={email}
                  onEmailChanged={(value) =>
                    confirmProfile({ email: { previous: sessionEmail, value } })
                  }
                />
                <p className='text-muted-foreground text-xs'>{tAccount('emailHint')}</p>
              </div>
            </div>

            <div className='rounded-sm border bg-muted/30 px-4 py-4'>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <Label className='font-semibold text-sm'>{tAccount('passwordReset')}</Label>
                  <p className='text-muted-foreground text-sm'>
                    {tAccount('passwordResetDescription')}
                  </p>
                </div>
                <Button
                  type='button'
                  size='sm'
                  onClick={handlePasswordReset}
                  disabled={isSendingReset}
                >
                  {isSendingReset ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      {tAccount('sending')}
                    </>
                  ) : (
                    tAccount('sendLink')
                  )}
                </Button>
              </div>
              {passwordResetStatus && (
                <p
                  className={`mt-3 text-sm ${
                    passwordResetStatus.type === 'success' ? 'text-emerald-600' : 'text-destructive'
                  }`}
                  role='status'
                >
                  {passwordResetStatus.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className='px-6 pb-6'>
        <Card className='border-none shadow-none'>
          <CardHeader className='space-y-1 pb-5'>
            <CardTitle className='font-semibold text-lg'>{tAccount('privacy')}</CardTitle>
            <p className='text-muted-foreground text-sm'>{tAccount('privacyDescription')}</p>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <Label htmlFor='telemetry' className='font-normal'>
                      {tAccount('telemetry.label')}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='sm'
                            className='h-7 p-1 text-gray-500'
                            aria-label={tAccount('telemetry.tooltipLabel')}
                            disabled={isTelemetrySettingsLoading || isTelemetryLoading}
                          >
                            <Info className='h-5 w-5' />
                          </Button>
                        }
                      />
                      <TooltipContent side='top' className='max-w-[300px] p-3'>
                        <p className='text-sm'>{tAccount('telemetry.tooltipBody')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Switch
                    id='telemetry'
                    checked={telemetryEnabled}
                    onCheckedChange={handleTelemetryToggle}
                    disabled={isTelemetrySettingsLoading || isTelemetryLoading}
                  />
                </div>
                <p className='text-muted-foreground text-xs'>{tAccount('telemetry.body')}</p>
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
