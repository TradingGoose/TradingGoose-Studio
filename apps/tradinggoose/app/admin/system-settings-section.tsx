'use client'

import { type ChangeEvent, useEffect, useState } from 'react'
import { Eye, EyeOff, Settings2 } from 'lucide-react'
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
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from './badge-styles'

const EMPTY_SNAPSHOT: AdminSystemSettingsSnapshot = {
  registrationMode: 'open',
  billingEnabled: false,
  billingReady: false,
  allowPromotionCodes: true,
  stripeSecretKey: '',
  stripeWebhookSecret: '',
}

export function AdminSystemSettingsSection() {
  const snapshotQuery = useAdminSystemSettingsSnapshot()
  const updateMutation = useUpdateAdminSystemSettings()
  const [draft, setDraft] = useState<AdminSystemSettingsSnapshot | null>(null)
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
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
  const stripeConfigured =
    settings.stripeSecretKey.trim().length > 0 && settings.stripeWebhookSecret.trim().length > 0
  const stripeStatusLabel = stripeConfigured ? 'Stripe ready' : 'Stripe incomplete'

  async function handleSave() {
    setError(null)
    setMessage(null)

    try {
      const { billingReady: _billingReady, ...input } = settings
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
              <Badge
                variant='outline'
                className={`${ADMIN_STATUS_BADGE_CLASSNAME} ${
                  stripeConfigured
                    ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-500'
                    : 'border-destructive/20 bg-destructive/15 text-destructive'
                }`}
              >
                {stripeStatusLabel}
              </Badge>
            </div>
            <CardTitle className='text-sm'>Platform controls and Stripe credentials</CardTitle>
            <CardDescription>
              Manage the global system flags that gate registration, billing behavior, and Stripe
              access for the whole platform.
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
                  and checkout behavior.
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
              </div>
            </div>

            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>Stripe credentials</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  These values are stored encrypted in the database using the same secret handling
                  pattern as admin-managed integration credentials.
                </p>
              </div>

              <SecretField
                id='stripe-secret-key'
                label='STRIPE_SECRET_KEY'
                hint='Secret API key used for Stripe operations and checkout.'
                value={settings.stripeSecretKey}
                revealed={showSecretKey}
                onRevealToggle={() => setShowSecretKey((current) => !current)}
                onChange={(event) => updateField('stripeSecretKey', event.target.value)}
              />

              <SecretField
                id='stripe-webhook-secret'
                label='STRIPE_WEBHOOK_SECRET'
                hint='Signing secret used to validate incoming Stripe webhooks.'
                value={settings.stripeWebhookSecret}
                revealed={showWebhookSecret}
                onRevealToggle={() => setShowWebhookSecret((current) => !current)}
                onChange={(event) => updateField('stripeWebhookSecret', event.target.value)}
              />
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

function SecretField({
  id,
  label,
  hint,
  value,
  revealed,
  onRevealToggle,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  revealed: boolean
  onRevealToggle: () => void
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className='space-y-2'>
      <div className='space-y-1'>
        <Label htmlFor={id} className='font-medium text-sm'>
          {label}
        </Label>
        <p className='text-muted-foreground text-xs leading-relaxed'>{hint}</p>
      </div>
      <div className='flex items-center gap-2'>
        <Input id={id} type={revealed ? 'text' : 'password'} value={value} onChange={onChange} />
        <Button
          type='button'
          variant='outline'
          size='icon'
          className='shrink-0'
          onClick={onRevealToggle}
        >
          {revealed ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
          <span className='sr-only'>{revealed ? 'Hide secret' : 'Show secret'}</span>
        </Button>
      </div>
    </div>
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
