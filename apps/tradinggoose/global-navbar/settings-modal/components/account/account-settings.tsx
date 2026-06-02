"use client"

import Image from 'next/image'
import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AlertCircle, Check, Info, Loader2, Pencil, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentIcon } from '@/components/icons/icons'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import { createLogger } from '@/lib/logs/console/logger'
import { useSession } from '@/lib/auth-client'
import { useProfilePictureUpload } from '@/global-navbar/settings-modal/components/hooks/use-profile-picture-upload'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useGeneralStore } from '@/stores/settings/general/store'
const logger = createLogger('AccountSettings')
const DEFAULT_AVATAR_SRC = '/profile/avatar.png'

const toEpochMillis = (value: string | Date | null | undefined): number | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

export function AccountSettings() {
  const { data: session } = useSession()
  const authRedirectUrls = useAuthRedirectUrls()
  const tAccount = useTranslations('workspace.settingsModal.account')
  const userId = session?.user?.id ?? null

  // Telemetry state from general store
  const { isPending: isSettingsPending } = useGeneralSettings()
  const storeIsLoading = useGeneralStore((state) => state.isLoading)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)
  const isTelemetryLoading = useGeneralStore((state) => state.isTelemetryLoading)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)
  const isTelemetrySettingsLoading = isSettingsPending || storeIsLoading

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

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [profilePictureError, setProfilePictureError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [passwordResetStatus, setPasswordResetStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editingNameValue, setEditingNameValue] = useState('')
  const [isUpdatingName, setIsUpdatingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [userImage, setUserImage] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState<number | null>(null)

  const editNameInputRef = useRef<HTMLInputElement>(null)
  const nameEditActionRef = useRef<'save' | 'cancel' | null>(null)

  const updateUserImage = async (imageUrl: string | null) => {
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl }),
      })

      if (!response.ok) {
        throw new Error(
          imageUrl
            ? tAccount('status.profilePictureUpdateError')
            : tAccount('status.profilePictureRemoveError')
        )
      }

      setUserImage(imageUrl)
      const version = Date.now()
      setAvatarVersion(version)
      if (typeof window !== 'undefined') {
        if (userId) {
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, imageUrl ?? '')
        }
        window.dispatchEvent(
          new CustomEvent('user-avatar-updated', { detail: { url: imageUrl, version } })
        )
      }
    } catch (error) {
      logger.error('Failed to update profile picture', error)
      const errorMessage =
        error instanceof Error ? error.message : tAccount('status.unableToUpdateProfilePicture')
      setProfilePictureError(errorMessage)
      throw new Error(errorMessage)
    }
  }

  const {
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    isUploading,
  } = useProfilePictureUpload({
    messages: {
      fileTooLarge: (fileName) =>
        tAccount('status.profilePictureFileTooLarge', { name: fileName }),
      unsupportedFormat: (fileName) =>
        tAccount('status.profilePictureUnsupportedFormat', { name: fileName }),
      uploadFailed: tAccount('status.unableToUpdateProfilePicture'),
    },
    currentImage: userImage,
    onUpload: async (url) => {
      await updateUserImage(url)
      setProfilePictureError(null)
    },
    onError: (error) => {
      setProfilePictureError(error)
    },
  })

  useEffect(() => {
    const fetchProfile = async () => {
      if (!session?.user) return

      try {
        const response = await fetch('/api/users/me/profile')
        if (!response.ok) {
          throw new Error('Failed to fetch profile')
        }

        const data = await response.json()
        setName(data.user.name)
        setEmail(data.user.email)
        setUserImage(data.user.image || null)
        setAvatarVersion(data.user.updatedAt ? new Date(data.user.updatedAt).getTime() : Date.now())
        if (typeof window !== 'undefined' && userId) {
          const version =
            toEpochMillis(data.user.updatedAt) ?? Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, data.user.image ?? '')
          window.localStorage.setItem(`user-name-${userId}`, data.user.name ?? '')
        }
      } catch (error) {
        logger.error('Error fetching profile:', error)
        setName(session?.user?.name ?? '')
        setEmail(session?.user?.email ?? '')
        setUserImage(session?.user?.image ?? null)
        setAvatarVersion(
          session?.user?.updatedAt ? new Date(session.user.updatedAt).getTime() : Date.now()
        )
        if (typeof window !== 'undefined' && userId) {
          const version =
            toEpochMillis(session?.user?.updatedAt) ?? Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, session?.user?.image ?? '')
          window.localStorage.setItem(`user-name-${userId}`, session?.user?.name ?? '')
        }
      }
    }

    void fetchProfile()
  }, [session?.user, userId])

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
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) {
        setNameError(tAccount('status.failedUpdateName'))
        editNameInputRef.current?.focus()
        return
      }

      setName(trimmedName)
      setIsEditingName(false)
      if (typeof window !== 'undefined') {
        if (userId) {
          window.localStorage.setItem(`user-name-${userId}`, trimmedName)
        }
        window.dispatchEvent(new CustomEvent('user-name-updated', { detail: { name: trimmedName } }))
      }
    } catch (error) {
      logger.error('Error updating name:', error)
      setNameError(tAccount('status.unableToUpdateName'))
      editNameInputRef.current?.focus()
    } finally {
      setIsUpdatingName(false)
    }
  }

  const handlePasswordReset = async () => {
    const targetEmail = session?.user?.email ?? email
    if (!targetEmail) {
      setPasswordResetStatus({
        type: 'error',
        message: tAccount('status.noEmail'),
      })
      return
    }

    setIsSendingReset(true)
    setPasswordResetStatus(null)
    try {
      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          redirectTo: authRedirectUrls.passwordResetUrl(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const rawMessage =
          errorData?.message ??
          errorData?.error?.message ??
          errorData?.error
        const normalizedError =
          typeof rawMessage === 'string' ? rawMessage.trim().toLowerCase() : ''

        if (normalizedError.includes('email is required')) {
          throw new Error(tAccount('status.noEmail'))
        }

        throw new Error(tAccount('status.passwordResetFailed'))
      }

      setPasswordResetStatus({
        type: 'success',
        message: tAccount('status.passwordResetSent'),
      })
    } catch (error) {
      logger.error('Error requesting password reset:', error)
      setPasswordResetStatus({
        type: 'error',
        message:
          error instanceof Error ? error.message : tAccount('status.passwordResetFailed'),
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

    if (event.dataTransfer.files?.length) {
      const syntheticEvent = {
        target: { files: event.dataTransfer.files },
      } as unknown as ChangeEvent<HTMLInputElement>
      void handleFileChange(syntheticEvent)
    }
  }

  const avatarSrc = useMemo(() => {
    // Keep showing the local preview (blob URL) while uploading.
    if (previewUrl?.startsWith('blob:')) return previewUrl

    const base = userImage || session?.user?.image || previewUrl || DEFAULT_AVATAR_SRC
    if (!base) return DEFAULT_AVATAR_SRC

    const version =
      avatarVersion ??
      (session?.user?.updatedAt ? new Date(session.user.updatedAt).getTime() : null)

    if (!version || base === DEFAULT_AVATAR_SRC) return base
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}v=${version}`
  }, [avatarVersion, previewUrl, session?.user?.image, session?.user?.updatedAt, userImage])

  return (
    <div className='bg-background px-6 py-6'>
      <div className='grid gap-6 p-6 sm:grid-cols-[280px,1fr] '>
        <Card className='border-none  shadow-none'>
          <CardHeader className='pb-4'>
            <CardTitle className='text-base font-semibold'>{tAccount('profilePicture')}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div
              className={`group relative flex flex-col items-center justify-center gap-4 rounded-md border-2 border-dashed px-4 py-6 text-center transition-all ${isDragActive
                ? 'border-primary bg-primary/10'
                : 'border-muted-foreground/35 bg-card hover:border-primary/40 hover:bg-muted/70'
                }`}
              onClick={handleThumbnailClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Input
                type='file'
                accept='image/png,image/jpeg,image/jpg'
                className='hidden'
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isUploading}
              />
              <div className='relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border bg-muted shadow-sm'>
                {avatarSrc ? (
                  <Image
                    src={avatarSrc}
                    alt={name || session?.user?.name || tAccount('profilePictureAlt')}
                    width={96}
                    height={96}
                    className='h-full w-full object-cover'
                  />
                ) : (
                  <AgentIcon className='h-10 w-10 text-muted-foreground' />
                )}
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
            <CardTitle className='text-lg font-semibold'>{tAccount('profileDetails')}</CardTitle>
            <p className='text-muted-foreground text-sm'>
              {tAccount('profileDetailsDescription')}
            </p>
          </CardHeader>
          <CardContent className='space-y-5'>
            <div className='space-y-3'>
              <div className='space-y-1'>
                <Label htmlFor='accountName'>{tAccount('fullName')}</Label>
                {isEditingName ? (
                  <div className='py-1.5'>
                    <div className='flex items-center gap-2 max-w-md'>
                      <Input
                        id='accountName'
                        ref={editNameInputRef}
                        value={editingNameValue}
                        onChange={(event) => setEditingNameValue(event.target.value)}
                        onBlur={() => {
                          if (nameEditActionRef.current === 'save') {
                            return
                          }
                          nameEditActionRef.current = null
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
                        className='h-8 flex-1 min-w-0'
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
                          nameEditActionRef.current = 'cancel'
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
                <Label>{tAccount('emailAddress')}</Label>
                <div className='rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
                  {email || '—'}
                </div>
                <p className='text-muted-foreground text-xs'>{tAccount('emailHint')}</p>
              </div>
            </div>

            <div className='rounded-sm border bg-muted/30 px-4 py-4'>
              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <Label className='text-sm font-semibold'>{tAccount('passwordReset')}</Label>
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
                  className={`mt-3 text-sm ${passwordResetStatus.type === 'success' ? 'text-emerald-600' : 'text-destructive'
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
            <CardTitle className='text-lg font-semibold'>{tAccount('privacy')}</CardTitle>
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
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 p-1 text-gray-500'
                          aria-label={tAccount('telemetry.tooltipLabel')}
                          disabled={isTelemetrySettingsLoading || isTelemetryLoading}
                        >
                          <Info className='h-5 w-5' />
                        </Button>
                      </TooltipTrigger>
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
                <p className='text-muted-foreground text-xs'>
                  {tAccount('telemetry.body')}
                </p>
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
