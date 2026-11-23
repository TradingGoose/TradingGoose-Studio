'use client'

import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Info, Loader2, Pencil, X } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useSaveUsername } from '@/components/auth/username-form'
import { VerifyCurrentEmail } from '@/components/auth/verify-current-email'
import { AgentIcon } from '@/components/icons/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuthRedirectUrls } from '@/lib/auth/redirect-urls'
import {
  type CurrentEmailVerification,
  requestEmailChangeLink,
  useSession,
} from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useProfilePictureUpload } from '@/global-navbar/settings-modal/components/hooks/use-profile-picture-upload'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('AccountSettings')
const DEFAULT_AVATAR_SRC = '/profile/avatar.png'

const toEpochMillis = (value: string | Date | null | undefined): number | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

const editButtonClass =
  'inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'

function ProfileNameField({
  id,
  value,
  onSave,
}: {
  id: 'accountName' | 'username'
  value: string
  onSave: (value: string) => Promise<string | undefined>
}) {
  const t = useTranslations('workspace.settingsModal.account')
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const username = id === 'username'
  const editing = draft !== null

  useEffect(() => {
    if (editing) {
      input.current?.focus()
      input.current?.select()
    }
  }, [editing])

  useEffect(() => {
    if (error) input.current?.focus()
  }, [error])

  const cancel = () => {
    setDraft(null)
    setError('')
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft === null || busy) return
    const next = draft.trim()
    if (next && (username ? next.toLowerCase() === value.toLowerCase() : next === value)) {
      cancel()
      return
    }
    setBusy(true)
    setError('')
    const message = await onSave(next)
    setBusy(false)
    if (message) setError(message)
    else cancel()
  }

  return (
    <div className='space-y-1'>
      <Label htmlFor={id}>{t(username ? 'username.label' : 'fullName')}</Label>
      {editing ? (
        <form
          className='py-1.5'
          onSubmit={save}
          aria-busy={busy}
          onBlur={(event) => {
            if (!busy && !event.currentTarget.contains(event.relatedTarget)) cancel()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }
          }}
        >
          <div className='flex max-w-md items-center gap-2'>
            <Input
              id={id}
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              required={username}
              autoComplete={username ? 'username' : 'off'}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              className='h-8 min-w-0 flex-1'
            />
            <button
              type='submit'
              className={editButtonClass}
              onMouseDown={(event) => event.preventDefault()}
              disabled={busy}
            >
              <Check className='h-3.5 w-3.5' />
              <span className='sr-only'>{t(username ? 'username.save' : 'saveName')}</span>
            </button>
            <button type='button' className={editButtonClass} onClick={cancel} disabled={busy}>
              <X className='h-3.5 w-3.5' />
              <span className='sr-only'>
                {t(username ? 'username.cancel' : 'cancelEditingName')}
              </span>
            </button>
          </div>
          {error && (
            <p role='alert' id={`${id}-error`} className='text-destructive text-xs'>
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className='flex items-center gap-2'>
          <p className='font-medium'>{value || '—'}</p>
          <button type='button' className={editButtonClass} onClick={() => setDraft(value)}>
            <Pencil className='h-3.5 w-3.5' />
            <span className='sr-only'>{t(username ? 'username.edit' : 'editName')}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function ResetLinkControl({
  label,
  description,
  sent,
  failed,
  send,
}: {
  label: string
  description: string
  sent: string
  failed: string
  send: () => Promise<string | undefined>
}) {
  const t = useTranslations('workspace.settingsModal.account')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null)

  async function handleSend() {
    setSending(true)
    setStatus(null)
    try {
      const error = await send()
      setStatus({ success: !error, message: error || sent })
    } catch {
      setStatus({ success: false, message: failed })
    } finally {
      setSending(false)
    }
  }

  return (
    <div role='group' aria-label={label} className='rounded-sm border bg-muted/30 px-4 py-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <Label className='font-semibold text-sm'>{label}</Label>
          <p className='text-muted-foreground text-sm'>{description}</p>
        </div>
        <Button type='button' size='sm' onClick={handleSend} disabled={sending}>
          {sending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {t(sending ? 'sending' : 'sendLink')}
        </Button>
      </div>
      {status && (
        <p
          role='status'
          className={`mt-3 text-sm ${status.success ? 'text-emerald-600' : 'text-destructive'}`}
        >
          {status.message}
        </p>
      )}
    </div>
  )
}

export function AccountSettings() {
  const { data: session } = useSession()
  const saveUsername = useSaveUsername()
  const authRedirectUrls = useAuthRedirectUrls()
  const tAccount = useTranslations('workspace.settingsModal.account')
  const userId = session?.user?.id ?? null
  const [verification, setVerification] = useState<CurrentEmailVerification | null>(null)

  // Telemetry state from general store
  const storeIsLoading = useGeneralStore((state) => state.isLoading)
  const telemetryEnabled = useGeneralStore((state) => state.telemetryEnabled)
  const isTelemetryLoading = useGeneralStore((state) => state.isTelemetryLoading)
  const setTelemetryEnabled = useGeneralStore((state) => state.setTelemetryEnabled)
  const isTelemetrySettingsLoading = storeIsLoading

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
  const email = session?.user?.email ?? ''
  const [profilePictureError, setProfilePictureError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [userImage, setUserImage] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState<number | null>(null)

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

  const { previewUrl, fileInputRef, handleThumbnailClick, handleFileChange, isUploading } =
    useProfilePictureUpload({
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
        setUserImage(data.user.image || null)
        setAvatarVersion(data.user.updatedAt ? new Date(data.user.updatedAt).getTime() : Date.now())
        if (typeof window !== 'undefined' && userId) {
          const version = toEpochMillis(data.user.updatedAt) ?? Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, data.user.image ?? '')
          window.localStorage.setItem(`user-name-${userId}`, data.user.name ?? '')
        }
      } catch (error) {
        logger.error('Error fetching profile:', error)
        setName(session?.user?.name ?? '')
        setUserImage(session?.user?.image ?? null)
        setAvatarVersion(
          session?.user?.updatedAt ? new Date(session.user.updatedAt).getTime() : Date.now()
        )
        if (typeof window !== 'undefined' && userId) {
          const version = toEpochMillis(session?.user?.updatedAt) ?? Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, session?.user?.image ?? '')
          window.localStorage.setItem(`user-name-${userId}`, session?.user?.name ?? '')
        }
      }
    }

    void fetchProfile()
  }, [session?.user, userId])

  const saveName = async (trimmedName: string) => {
    if (!trimmedName) return tAccount('status.nameRequiredValidation')
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })

      if (!response.ok) return tAccount('status.failedUpdateName')

      setName(trimmedName)
      if (typeof window !== 'undefined') {
        if (userId) {
          window.localStorage.setItem(`user-name-${userId}`, trimmedName)
        }
        window.dispatchEvent(
          new CustomEvent('user-name-updated', { detail: { name: trimmedName } })
        )
      }
    } catch (error) {
      logger.error('Error updating name:', error)
      return tAccount('status.unableToUpdateName')
    }
  }

  const sendPasswordReset = async () => {
    if (!email) return tAccount('status.noEmail')
    const response = await fetch('/api/auth/forget-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirectTo: authRedirectUrls.passwordResetUrl() }),
    })
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const rawMessage = errorData?.message ?? errorData?.error?.message ?? errorData?.error
      if (
        typeof rawMessage === 'string' &&
        rawMessage.toLowerCase().includes('email is required')
      ) {
        return tAccount('status.noEmail')
      }
      return tAccount('status.passwordResetFailed')
    }
  }

  const sendEmailReset = async () => {
    if (!userId || !email) return tAccount('status.noEmail')
    setVerification(await requestEmailChangeLink(userId))
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
            <CardTitle className='font-semibold text-lg'>{tAccount('profileDetails')}</CardTitle>
            <p className='text-muted-foreground text-sm'>{tAccount('profileDetailsDescription')}</p>
          </CardHeader>
          <CardContent className='space-y-5'>
            <div className='space-y-3'>
              <ProfileNameField id='accountName' value={name} onSave={saveName} />
              <ProfileNameField
                id='username'
                value={session?.user?.username ?? ''}
                onSave={saveUsername}
              />
            </div>
            {verification && verification.accountId === userId ? (
              <VerifyCurrentEmail {...verification} />
            ) : (
              <ResetLinkControl
                label={tAccount('emailAddress')}
                description={tAccount('emailResetDescription', { email: email || '—' })}
                sent={tAccount('status.emailResetSent')}
                failed={tAccount('status.emailResetFailed')}
                send={sendEmailReset}
              />
            )}
            <ResetLinkControl
              label={tAccount('passwordReset')}
              description={tAccount('passwordResetDescription')}
              sent={tAccount('status.passwordResetSent')}
              failed={tAccount('status.passwordResetFailed')}
              send={sendPasswordReset}
            />
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
