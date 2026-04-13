'use client'

import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Notice,
  Switch,
} from '@/components/ui'
import type { AdminSystemSettingsSnapshot } from '@/lib/admin/system-settings/types'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'
import {
  useAdminSystemSettingsSnapshot,
  useUpdateAdminSystemSettings,
} from '@/hooks/queries/admin-system-settings'
import { ADMIN_META_BADGE_CLASSNAME } from './badge-styles'

const EMPTY_SNAPSHOT: AdminSystemSettingsSnapshot = {
  registrationMode: 'open',
  billingEnabled: false,
  billingReady: false,
  triggerDevEnabled: false,
  triggerReady: false,
  allowPromotionCodes: true,
  emailDomain: 'tradinggoose.ai',
  fromEmailAddress: '',
}

export function AdminSystemSettingsSection() {
  const snapshotQuery = useAdminSystemSettingsSnapshot()
  const updateMutation = useUpdateAdminSystemSettings()
  const [draft, setDraft] = useState<AdminSystemSettingsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!snapshotQuery.data || draft !== null) {
      return
    }

    setDraft(snapshotQuery.data)
  }, [draft, snapshotQuery.data])

  useEffect(() => {
    if (!message) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null)
    }, 3000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [message])

  const settings = draft ?? EMPTY_SNAPSHOT

  async function handleSave() {
    setError(null)
    setMessage(null)

    try {
      const input = {
        registrationMode: settings.registrationMode,
        billingEnabled: settings.billingEnabled,
        triggerDevEnabled: settings.triggerDevEnabled,
        allowPromotionCodes: settings.allowPromotionCodes,
        emailDomain: settings.emailDomain,
        fromEmailAddress: settings.fromEmailAddress,
      }
      const nextSnapshot = await updateMutation.mutateAsync(input)
      setDraft(nextSnapshot)
      setMessage('System settings updated')
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    }
  }

  if (!draft && snapshotQuery.isPending) {
    return (
      <Card className='border border-border bg-muted/10'>
        <CardContent className='flex min-h-[220px] items-center justify-center px-4 py-6 sm:px-5'>
          <p className='text-muted-foreground text-sm'>Loading system settings...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className='overflow-hidden rounded-lg border border-border bg-muted/10'>
      <CardHeader className='border-border/60 border-b bg-muted/10 px-4 py-4 sm:px-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-1'>
            <div className='flex items-center gap-2'>
              <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                <Settings2 className='mr-1 h-3.5 w-3.5' />
                System settings
              </Badge>
            </div>
            <CardTitle className='text-sm'>Platform controls</CardTitle>
            <CardDescription>
              Manage the global app-owned settings that control registration, billing behavior, and
              platform sender identity.
            </CardDescription>
          </div>
          <div className='hidden items-center gap-3 rounded-md border bg-background px-3 py-1.5 xl:flex'>
            <div className='flex items-baseline gap-1 whitespace-nowrap'>
              <span className='text-[11px] text-muted-foreground'>Registration</span>
              <span className='font-medium text-[11px] text-foreground capitalize'>
                {settings.registrationMode}
              </span>
            </div>
            <div className='flex items-baseline gap-1 whitespace-nowrap'>
              <span className='text-[11px] text-muted-foreground'>Billing</span>
              <span className='font-medium text-[11px] text-foreground'>
                {settings.billingEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className='flex items-baseline gap-1 whitespace-nowrap'>
              <span className='text-[11px] text-muted-foreground'>Promo Codes</span>
              <span className='font-medium text-[11px] text-foreground'>
                {settings.allowPromotionCodes ? 'Allowed' : 'Blocked'}
              </span>
            </div>
            <div className='flex items-baseline gap-1 whitespace-nowrap'>
              <span className='text-[11px] text-muted-foreground'>Trigger.dev</span>
              <span className='font-medium text-[11px] text-foreground'>
                {settings.triggerDevEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-4 bg-muted/10 px-4 py-4 sm:px-5'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(snapshotQuery.error)}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Notice variant='success' title='Saved'>
            {message}
          </Notice>
        ) : null}

        <fieldset disabled={updateMutation.isPending} className='space-y-4'>
          <div className='grid gap-4 xl:grid-cols-[1.15fr_1fr]'>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Access controls</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Registration mode drives public signups, while billing flags control paid flows
                  and execution behavior.
                </p>
              </div>

              <div className='space-y-2'>
                <Label className='font-medium text-sm'>Registration mode</Label>
                <div className='flex flex-wrap gap-2'>
                  {REGISTRATION_MODE_VALUES.map((mode) => {
                    const isActive = settings.registrationMode === mode

                    return (
                      <Button
                        key={mode}
                        type='button'
                        variant={isActive ? 'default' : 'outline'}
                        className='capitalize'
                        onClick={() => updateField('registrationMode', mode)}
                      >
                        {mode}
                      </Button>
                    )
                  })}
                </div>
              </div>

              <div className='space-y-3 rounded-md border border-border/60 bg-muted/20 px-3 py-3'>
                {!settings.billingReady ? (
                  <Alert>
                    <AlertDescription>
                      Billing stays disabled until an active public default user tier exists. You
                      can keep the default tier in draft while editing, then activate it and turn
                      billing back on here.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <SettingSwitch
                  id='billing-enabled'
                  label='Billing enabled'
                  hint={
                    settings.billingReady
                      ? 'Turns paid billing flows on across the platform.'
                      : 'Requires an active public default user tier before billing can be enabled.'
                  }
                  checked={settings.billingEnabled}
                  disabled={!settings.billingReady}
                  onCheckedChange={(checked) => updateField('billingEnabled', checked)}
                />
                <SettingSwitch
                  id='allow-promotion-codes'
                  label='Allow promotion codes'
                  hint='Controls whether promo codes are allowed during checkout.'
                  checked={settings.allowPromotionCodes}
                  onCheckedChange={(checked) => updateField('allowPromotionCodes', checked)}
                />
                {!settings.triggerReady ? (
                  <Alert>
                    <AlertDescription>
                      Trigger.dev stays disabled until both `TRIGGER_PROJECT_ID` and
                      `TRIGGER_SECRET_KEY` are configured in the deployment environment.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <SettingSwitch
                  id='trigger-dev-enabled'
                  label='Trigger.dev enabled'
                  hint={
                    settings.triggerReady
                      ? 'Routes supported async jobs through Trigger.dev instead of direct in-process execution.'
                      : 'Requires Trigger.dev project credentials in the deployment environment.'
                  }
                  checked={settings.triggerDevEnabled}
                  disabled={!settings.triggerReady}
                  onCheckedChange={(checked) => updateField('triggerDevEnabled', checked)}
                />
              </div>
            </div>

            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Email identity</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  These values control the platform sender identity and support inbox.
                </p>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='email-domain' className='font-medium text-sm'>
                  Email domain
                </Label>
                <Input
                  id='email-domain'
                  value={settings.emailDomain}
                  onChange={(event) => updateField('emailDomain', event.target.value)}
                  placeholder='tradinggoose.ai'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='from-email-address' className='font-medium text-sm'>
                  From email address
                </Label>
                <Input
                  id='from-email-address'
                  value={settings.fromEmailAddress}
                  onChange={(event) => updateField('fromEmailAddress', event.target.value)}
                  placeholder='TradingGoose <noreply@tradinggoose.ai>'
                />
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  Leave blank to use the default sender built from the email domain.
                </p>
              </div>
            </div>
          </div>

          <div className='flex items-center justify-end'>
            <Button type='button' onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save system settings'}
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  )

  function updateField<Key extends keyof AdminSystemSettingsSnapshot>(
    key: Key,
    value: AdminSystemSettingsSnapshot[Key]
  ) {
    setDraft((current) => ({
      ...(current ?? EMPTY_SNAPSHOT),
      [key]: value,
    }))
  }
}

function SettingSwitch({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className='flex items-start justify-between gap-4'>
      <div className='space-y-1'>
        <Label htmlFor={id} className='font-medium text-sm'>
          {label}
        </Label>
        <p className='text-muted-foreground text-xs leading-relaxed'>{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
