'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Pencil, X } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { AgentIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { signOut, useSession } from '@/lib/auth-client'
import { useBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { useProfilePictureUpload } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/account/hooks/use-profile-picture-upload'
import { clearUserData } from '@/stores'

const logger = createLogger('Account')

interface AccountProps {
  onOpenChange: (open: boolean) => void
}

export function Account(_props: AccountProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()

  const { data: session, isPending } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userImage, setUserImage] = useState<string | null>(null)

  const [isLoadingProfile, setIsLoadingProfile] = useState(false)
  const [isUpdatingName, setIsUpdatingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const [isEditingName, setIsEditingName] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [resetPasswordMessage, setResetPasswordMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)

  const {
    previewUrl: profilePictureUrl,
    fileInputRef: profilePictureInputRef,
    handleThumbnailClick: handleProfilePictureClick,
    handleFileChange: handleProfilePictureChange,
    isUploading: isUploadingProfilePicture,
  } = useProfilePictureUpload({
    currentImage: userImage,
    onUpload: async (url) => {
      if (url) {
        try {
          await updateUserImage(url)
          setUploadError(null)
        } catch (error) {
          setUploadError('Failed to update profile picture')
        }
      } else {
        try {
          await updateUserImage(null)
          setUploadError(null)
        } catch (error) {
          setUploadError('Failed to remove profile picture')
        }
      }
    },
    onError: (error) => {
      setUploadError(error)
      setTimeout(() => setUploadError(null), 5000)
    },
  })

  const updateUserImage = async (imageUrl: string | null) => {
    try {
      const response = await fetch('/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update profile picture')
      }

      setUserImage(imageUrl)
    } catch (error) {
      logger.error('Error updating profile image:', error)
      throw error
    }
  }

  useEffect(() => {
    const fetchProfile = async () => {
      if (!session?.user) return

      setIsLoadingProfile(true)

      try {
        const response = await fetch('/api/users/me/profile')
        if (!response.ok) {
          throw new Error('Failed to fetch profile')
        }

        const data = await response.json()
        setName(data.user.name)
        setEmail(data.user.email)
        setUserImage(data.user.image)
      } catch (error) {
        logger.error('Error fetching profile:', error)
        if (session?.user) {
          setName(session.user.name || '')
          setEmail(session.user.email || '')
          setUserImage(session.user.image || null)
        }
      } finally {
        setIsLoadingProfile(false)
      }
    }

    fetchProfile()
  }, [session])

  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditingName])

  const handleUpdateName = async () => {
    const trimmedName = name.trim()

    if (!trimmedName) {
      setNameError('Name is required')
      inputRef.current?.focus()
      return
    }

    if (trimmedName === (session?.user?.name || '')) {
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
        const error = await response.json()
        setNameError(error.error || 'Failed to update name')
        throw new Error(error.error || 'Failed to update name')
      }

      setIsEditingName(false)
    } catch (error) {
      logger.error('Error updating name:', error)
      setName(session?.user?.name || '')
      setNameError('Unable to update name. Please try again.')
    } finally {
      setIsUpdatingName(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleUpdateName()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleCancelEdit = () => {
    setIsEditingName(false)
    setName(session?.user?.name || '')
    setNameError(null)
  }

  const handleInputBlur = () => {
    handleUpdateName()
  }

  const handleSignOut = async () => {
    try {
      await Promise.all([signOut(), clearUserData()])
      router.push('/login?fromLogout=true')
    } catch (error) {
      logger.error('Error signing out:', { error })
      router.push('/login?fromLogout=true')
    }
  }

  const handleResetPassword = async () => {
    setIsResettingPassword(true)
    setResetPasswordMessage(null)

    try {
      const response = await fetch('/api/auth/forget-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: `${getBaseUrl()}/reset-password`,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to send reset password email')
      }

      setResetPasswordMessage({
        type: 'success',
        text: 'email sent',
      })

      setTimeout(() => {
        setResetPasswordMessage(null)
      }, 5000)
    } catch (error) {
      logger.error('Error resetting password:', error)
      setResetPasswordMessage({
        type: 'error',
        text: 'error',
      })

      setTimeout(() => {
        setResetPasswordMessage(null)
      }, 5000)
    } finally {
      setIsResettingPassword(false)
    }
  }

  return (
    <div className='px-6 pt-4 pb-4'>
      <div className='flex flex-col gap-4'>
        {isLoadingProfile || isPending ? (
          <>
            {/* User Info Section Skeleton */}
            <div className='flex items-center gap-4'>
              {/* User Avatar Skeleton */}
              <Skeleton className='h-10 w-10 rounded-full' />

              {/* User Details Skeleton */}
              <div className='flex flex-col'>
                <Skeleton className='mb-1 h-5 w-32' />
                <Skeleton className='h-5 w-48' />
              </div>
            </div>

            {/* Name Field Skeleton */}
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <div className='flex items-center gap-4'>
                <Skeleton className='h-5 w-40' />
                <Skeleton className='h-5 w-[42px]' />
              </div>
            </div>

            {/* Email Field Skeleton */}
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-5 w-48' />
            </div>

            {/* Password Field Skeleton */}
            <div className='flex flex-col gap-2'>
              <Skeleton className='h-4 w-16' />
              <div className='flex items-center gap-4'>
                <Skeleton className='h-5 w-20' />
                <Skeleton className='h-5 w-[42px]' />
              </div>
            </div>

            {/* Sign Out Button Skeleton */}
            <div>
              <Skeleton className='h-8 w-[71px] rounded-sm' />
            </div>
          </>
        ) : (
          <>
            {/* User Info Section */}
            <div className='flex items-center gap-3 rounded-lg border bg-card/70 p-3 shadow-xs'>
              {/* Profile Picture Upload styled like user menu avatar */}
              <div className='relative'>
                <div
                  className='group relative flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/50'
                  onClick={handleProfilePictureClick}
                >
                  {(() => {
                    const imageUrl = profilePictureUrl || userImage || brandConfig.logoUrl
                    return imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={name || 'User'}
                        width={56}
                        height={56}
                        className={`h-full w-full object-cover transition-opacity duration-300 ${
                          isUploadingProfilePicture ? 'opacity-50' : 'opacity-100'
                        }`}
                      />
                    ) : (
                      <div className='flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-card to-primary/5'>
                        <AgentIcon className='h-6 w-6 text-primary' />
                      </div>
                    )
                  })()}

                  {/* Upload overlay */}
                  <div
                    className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${
                      isUploadingProfilePicture
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isUploadingProfilePicture ? (
                      <div className='h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent' />
                    ) : (
                      <Camera className='h-5 w-5 text-white' />
                    )}
                  </div>
                </div>

                {/* Hidden file input */}
                <Input
                  type='file'
                  accept='image/png,image/jpeg,image/jpg'
                  className='hidden'
                  ref={profilePictureInputRef}
                  onChange={handleProfilePictureChange}
                  disabled={isUploadingProfilePicture}
                />
              </div>

              {/* User Details */}
              <div className='flex flex-1 flex-col justify-center'>
                <h3 className='font-semibold text-base'>{name}</h3>
                <p className='text-muted-foreground text-sm'>{email}</p>
                {uploadError && <p className='mt-1 text-destructive text-xs'>{uploadError}</p>}
              </div>
            </div>

            {/* Name Field */}
            <div className='flex flex-col gap-2'>
              <Label htmlFor='name' className='font-normal text-muted-foreground text-sm'>
                Name
              </Label>
              {isEditingName ? (
                <div className='space-y-1'>
                  <div className='flex items-center gap-2 max-w-md'>
                    <Input
                      ref={inputRef}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={handleInputBlur}
                      className='h-9 flex-1'
                      maxLength={100}
                      disabled={isUpdatingName}
                      autoComplete='off'
                      autoCorrect='off'
                      autoCapitalize='off'
                      spellCheck='false'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-9 w-9 text-muted-foreground hover:text-foreground'
                      onClick={() => void handleUpdateName()}
                      disabled={isUpdatingName}
                    >
                      <Check className='h-4 w-4' />
                      <span className='sr-only'>Save name</span>
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-9 w-9 text-muted-foreground hover:text-foreground'
                      onClick={handleCancelEdit}
                      disabled={isUpdatingName}
                    >
                      <X className='h-4 w-4' />
                      <span className='sr-only'>Cancel</span>
                    </Button>
                  </div>
                  {nameError && <p className='text-destructive text-xs'>{nameError}</p>}
                </div>
              ) : (
                <div className='flex items-center gap-2'>
                  <span className='text-base font-medium'>{name}</span>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-muted-foreground transition-colors hover:text-foreground'
                    onClick={() => setIsEditingName(true)}
                    disabled={isUpdatingName}
                  >
                    <Pencil className='h-4 w-4' />
                    <span className='sr-only'>Edit name</span>
                  </Button>
                </div>
              )}
            </div>

            {/* Email Field - Read Only */}
            <div className='flex flex-col gap-2'>
              <Label className='font-normal text-muted-foreground text-sm'>Email</Label>
              <p className='text-base'>{email}</p>
            </div>

            {/* Password Field */}
            <div className='flex flex-col gap-2'>
              <Label className='font-normal text-muted-foreground text-sm'>Password</Label>
              <div className='flex items-center gap-4'>
                <span className='text-base'>••••••••</span>
                <Button
                  variant='ghost'
                  className={`h-auto p-0 font-normal text-sm transition-colors hover:bg-transparent ${
                    resetPasswordMessage
                      ? resetPasswordMessage.type === 'success'
                        ? 'text-green-500 hover:text-green-600'
                        : 'text-destructive hover:text-destructive/80'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={handleResetPassword}
                  disabled={isResettingPassword}
                >
                  {isResettingPassword
                    ? 'sending...'
                    : resetPasswordMessage
                      ? resetPasswordMessage.text
                      : 'reset'}
                  <span className='sr-only'>Reset password</span>
                </Button>
              </div>
            </div>

            {/* Sign Out Button */}
            <div>
              <Button
                onClick={handleSignOut}
                variant='destructive'
                className='h-8 rounded-sm bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
              >
                Sign Out
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
