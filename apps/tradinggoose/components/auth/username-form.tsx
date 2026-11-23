'use client'

import { type FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client, useSession } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'

export function UsernameInput({ error }: { error: string }) {
  const t = useTranslations('workspace.settingsModal.account.username')
  return (
    <div className='space-y-1'>
      <Label htmlFor='username'>{t('label')}</Label>
      <Input
        id='username'
        name='username'
        autoComplete='username'
        autoCapitalize='none'
        spellCheck={false}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'username-error' : undefined}
      />
      {error && (
        <p id='username-error' role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      )}
    </div>
  )
}

export function useSaveUsername() {
  const t = useTranslations('workspace.settingsModal.account.username')
  const { refetch } = useSession()

  return async (username: string) => {
    try {
      const availability = await client.isUsernameAvailable({ username })
      if (availability.error || !availability.data.available) {
        return availability.error?.message || t('taken')
      }
      const result = await client.updateUser({ username })
      if (result.error) {
        return result.error.code === 'USERNAME_IS_ALREADY_TAKEN'
          ? t('taken')
          : result.error.message || t('failed')
      }
      await refetch()
    } catch {
      return t('failed')
    }
  }
}

export function UsernameForm({ destination }: { destination: string }) {
  const t = useTranslations('workspace.settingsModal.account.username')
  const router = useRouter()
  const saveUsername = useSaveUsername()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const username = String(new FormData(event.currentTarget).get('username') ?? '').trim()
    setBusy(true)
    setError('')
    const error = await saveUsername(username)
    setBusy(false)
    if (error) setError(error)
    else router.replace(destination)
  }

  return (
    <form onSubmit={save} className='max-w-md space-y-2' aria-busy={busy}>
      <UsernameInput error={error} />
      <Button type='submit' size='sm' disabled={busy}>
        {t('save')}
      </Button>
    </form>
  )
}
