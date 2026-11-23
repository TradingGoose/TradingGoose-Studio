'use client'

import { type FormEvent, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client, useSession } from '@/lib/auth-client'
import { useRouter } from '@/i18n/navigation'

export function UsernameInput({ value, error }: { value?: string; error: string }) {
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
        defaultValue={value}
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

export function UsernameForm({ current, destination }: { current?: string; destination?: string }) {
  const t = useTranslations('workspace.settingsModal.account.username')
  const router = useRouter()
  const { refetch } = useSession()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const username = String(new FormData(event.currentTarget).get('username') ?? '').trim()
    setError('')
    if (current && username.toLowerCase() === current) {
      event.currentTarget.reset()
      return
    }
    setBusy(true)
    try {
      const availability = await client.isUsernameAvailable({ username })
      if (availability.error || !availability.data.available) {
        setError(availability.error?.message || t('taken'))
        return
      }
      const result = await client.updateUser({ username })
      if (result.error) {
        setError(
          result.error.code === 'USERNAME_IS_ALREADY_TAKEN'
            ? t('taken')
            : result.error.message || t('failed')
        )
        return
      }
      await refetch()
      if (destination) router.replace(destination)
    } catch {
      setError(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className='max-w-md space-y-2' aria-busy={busy}>
      <UsernameInput key={current} value={current} error={error} />
      <Button type='submit' size='sm' disabled={busy}>
        {t('save')}
      </Button>
    </form>
  )
}
