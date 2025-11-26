"use client"

import Image from 'next/image'
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AlertCircle, Check, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AgentIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { useSession } from '@/lib/auth-client'
import { getBaseUrl } from '@/lib/urls/utils'
import { useProfilePictureUpload } from '@/global-navbar/settings-modal/components/hooks/use-profile-picture-upload'
const logger = createLogger('AccountSettings')

export function AccountSettings() {
  const { data: session, refetch: refetchSession } = useSession()
  const userId = session?.user?.id ?? null
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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

  const updateUserImage = async (imageUrl: string | null) => {
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const message =
          typeof errorData?.error === 'string'
            ? errorData.error
            : imageUrl
              ? 'Failed to update profile picture'
              : 'Failed to remove profile picture'
        throw new Error(message)
      }

      setMessage('Profile saved.')
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
      setProfilePictureError(
        error instanceof Error ? error.message : 'Unable to update profile picture.'
      )
      throw error
    }
  }

  const {
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    isUploading,
  } = useProfilePictureUpload({
    currentImage: userImage,
    onUpload: async (url) => {
      try {
        await updateUserImage(url)
        setProfilePictureError(null)
      } catch (error) {
        setProfilePictureError(
          error instanceof Error ? error.message : 'Unable to update profile picture.'
        )
      }
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
            data.user.updatedAt && !Number.isNaN(Date.parse(data.user.updatedAt))
              ? new Date(data.user.updatedAt).getTime()
              : Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, data.user.image ?? '')
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
            session?.user?.updatedAt && !Number.isNaN(Date.parse(session.user.updatedAt))
              ? new Date(session.user.updatedAt).getTime()
              : Date.now()
          window.localStorage.setItem(`user-avatar-version-${userId}`, String(version))
          window.localStorage.setItem(`user-avatar-url-${userId}`, session?.user?.image ?? '')
        }
      }
    }

    void fetchProfile()
  }, [session?.user, userId])

  const handleSave = async () => {
    if (!name.trim()) {
      setMessage('Please provide a name.')
      return
    }
    setIsSaving(true)
    setMessage(null)
    try {
      await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })
      setMessage('Profile saved.')
    } catch (error) {
      logger.error('Failed to save profile', error)
      setMessage('Unable to save profile settings.')
    } finally {
      setIsSaving(false)
    }
  }

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
      setNameError('Name is required')
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
        const errorData = await response.json().catch(() => ({}))
        const message =
          typeof errorData?.error === 'string' ? errorData.error : 'Failed to update name'
        setNameError(message)
        editNameInputRef.current?.focus()
        return
      }

      setName(trimmedName)
      setIsEditingName(false)
      setMessage('Profile saved.')
    } catch (error) {
      logger.error('Error updating name:', error)
      setNameError('Unable to update name. Please try again.')
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
        message: 'No email address found for this account.',
      })
      return
    }

    setIsSendingReset(true)
    setPasswordResetStatus(null)
    try {
      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: targetEmail,
          redirectTo: `${getBaseUrl()}/reset-password`,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to send password reset email.')
      }

      setPasswordResetStatus({
        type: 'success',
        message: 'Password reset link sent to your inbox.',
      })
    } catch (error) {
      logger.error('Error requesting password reset:', error)
      setPasswordResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unable to send password reset email.',
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

    const base = userImage || session?.user?.image || previewUrl || null
    if (!base) return null

    const version =
      avatarVersion ??
      (session?.user?.updatedAt ? new Date(session.user.updatedAt).getTime() : null)

    if (!version) return base
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}v=${version}`
  }, [avatarVersion, previewUrl, session?.user?.image, session?.user?.updatedAt, userImage])

  return (
    <div className='bg-muted/20 px-6 py-6'>
        <Card className='rounded-md border bg-background shadow-xs'>
          <CardContent className='p-0'>
            <div className='grid gap-6 p-6 sm:grid-cols-[280px,1fr]'>
              <Card className='border-none bg-transparent shadow-none'>
                <CardHeader className='pb-4'>
                  <CardTitle className='text-base font-semibold'>Profile Photo</CardTitle>
                  <p className='text-muted-foreground text-sm'>Use a clear, centered headshot.</p>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div
                    className={`group relative flex flex-col items-center justify-center gap-4 rounded-sm border-2 border-dashed px-4 py-6 text-center transition-all ${isDragActive
                      ? 'border-primary bg-primary/10'
                      : 'border-muted-foreground/35 bg-card hover:border-primary/40 hover:bg-card/70'
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
                    <div className='relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border bg-muted shadow-sm'>
                      {avatarSrc ? (
                        <Image
                          src={avatarSrc}
                          alt={name || session?.user?.name || 'User'}
                          width={96}
                          height={96}
                          className='h-full w-full object-cover'
                        />
                      ) : (
                        <AgentIcon className='h-10 w-10 text-muted-foreground' />
                      )}
                      {isUploading && (
                        <div className='absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white'>
                          <Loader2 className='h-5 w-5 animate-spin' />
                        </div>
                      )}
                    </div>
                    <div className='space-y-1'>
                      <p className='font-medium text-sm'>Drop an image or click to upload</p>
                      <p className='text-muted-foreground text-xs'>PNG or JPG, max 5MB</p>
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
              <Card className='border-none bg-transparent shadow-none'>
                <CardHeader className='space-y-1 pb-5'>
                  <CardTitle className='text-lg font-semibold'>Profile Details</CardTitle>
                  <p className='text-muted-foreground text-sm'>Update your name and manage access.</p>
                </CardHeader>
                <CardContent className='space-y-5'>
                  <div className='space-y-3'>
                    <div className='space-y-1'>
                      <Label htmlFor='accountName'>Full name</Label>
                      {isEditingName ? (
                        <div className='py-1.5'>
                          <div className='flex items-center gap-2 max-w-md'>
                            <Input
                              id='accountName'
                              ref={editNameInputRef}
                              value={editingNameValue}
                              onChange={(event) => setEditingNameValue(event.target.value)}
                              onBlur={() => void commitEditingName()}
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
                              className='inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
                              onClick={() => void commitEditingName()}
                              disabled={isUpdatingName}
                            >
                              <Check className='h-3.5 w-3.5' />
                              <span className='sr-only'>Save name</span>
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
                            <span className='sr-only'>Edit name</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className='space-y-1'>
                      <Label>Email address</Label>
                      <div className='rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
                        {email || '—'}
                      </div>
                      <p className='text-muted-foreground text-xs'>Email changes are handled by support.</p>
                    </div>
                  </div>

                  <div className='rounded-sm border bg-muted/30 px-4 py-4'>
                    <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                      <div>
                        <Label className='text-sm font-semibold'>Password reset</Label>
                        <p className='text-muted-foreground text-sm'>We’ll email you a secure link.</p>
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
                            Sending…
                          </>
                        ) : (
                          'Send link'
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
          </CardContent>
        </Card>
      </div>
  )
}
