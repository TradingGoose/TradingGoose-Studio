'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useMessages } from 'next-intl'
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
import {
  ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS,
  type AdminSystemSettingsEditableFields,
  type AdminSystemSettingsSnapshot,
} from '@/lib/admin/system-settings/types'
import { REGISTRATION_MODE_VALUES } from '@/lib/registration/shared'
import { adminBillingKeys } from '@/hooks/queries/admin-billing'
import { adminRegistrationKeys } from '@/hooks/queries/admin-registration'
import {
  adminSystemSettingsKeys,
  updateAdminSystemSettings,
  useAdminSystemSettingsSnapshot,
} from '@/hooks/queries/admin-system-settings'
import { subscriptionKeys } from '@/hooks/queries/subscription'
import { ADMIN_META_BADGE_CLASSNAME } from './badge-styles'
import { getAdminSystemSettingsErrorMessage } from './errors'

const EMPTY_SNAPSHOT: AdminSystemSettingsSnapshot = {
  registrationMode: 'open',
  billingEnabled: false,
  stripeConfigured: false,
  billingReady: false,
  triggerDevEnabled: false,
  triggerReady: false,
  allowPromotionCodes: true,
  emailDomain: 'tradinggoose.ai',
  fromEmailAddress: '',
}

export function AdminSystemSettingsSection() {
  const publicCopy = useMessages()
  const copy = publicCopy.admin.systemSettings
  const registrationCopy = publicCopy.registration
  const snapshotQuery = useAdminSystemSettingsSnapshot()
  const queryClient = useQueryClient()
  const updateMutation = useMutation({
    mutationFn: updateAdminSystemSettings,
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(adminSystemSettingsKeys.snapshot(), snapshot)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminBillingKeys.snapshot() }),
        queryClient.invalidateQueries({ queryKey: adminRegistrationKeys.snapshot() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all }),
      ])
    },
  })
  const [draft, setDraft] = useState<AdminSystemSettingsSnapshot | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<AdminSystemSettingsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const writeLockRef = useRef(false)

  useEffect(() => {
    if (!snapshotQuery.data || draft !== null || savedSnapshot !== null) {
      return
    }

    setDraft(snapshotQuery.data)
    setSavedSnapshot(snapshotQuery.data)
  }, [draft, savedSnapshot, snapshotQuery.data])

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
  const dirtyInput = useMemo(
    () => (draft && savedSnapshot ? buildDirtyInput(savedSnapshot, draft) : {}),
    [draft, savedSnapshot]
  )
  const hasDirtyChanges = Object.keys(dirtyInput).length > 0

  async function handleSave() {
    if (writeLockRef.current || !hasDirtyChanges) {
      return
    }

    writeLockRef.current = true
    setError(null)
    setMessage(null)

    try {
      const nextSnapshot = await updateMutation.mutateAsync(dirtyInput)
      setDraft(nextSnapshot)
      setSavedSnapshot(nextSnapshot)
      setMessage(copy.savedMessage)
    } catch (submitError) {
      setError(getAdminSystemSettingsErrorMessage(copy, getErrorMessage(submitError)))
    } finally {
      writeLockRef.current = false
    }
  }

  if (!draft && snapshotQuery.isPending) {
    return (
      <Card
        role='status'
        aria-live='polite'
        aria-atomic='true'
        className='border border-border bg-muted/10'
      >
        <CardContent className='flex min-h-[220px] items-center justify-center px-4 py-6 sm:px-5'>
          <p className='text-muted-foreground text-sm'>{copy.loading}</p>
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
                {copy.badge}
              </Badge>
            </div>
            <CardTitle className='text-sm'>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </div>
          <div className='hidden items-center gap-3 rounded-md border bg-background px-3 py-1.5 xl:flex'>
            <div className='flex items-baseline gap-1 whitespace-nowrap'>
              <span className='text-[11px] text-muted-foreground'>{copy.status.registration}</span>
              <span className='font-medium text-[11px] text-foreground'>
                {registrationCopy[settings.registrationMode].primary}
              </span>
            </div>
            {settings.stripeConfigured ? (
              <>
                <div className='flex items-baseline gap-1 whitespace-nowrap'>
                  <span className='text-[11px] text-muted-foreground'>{copy.status.billing}</span>
                  <span className='font-medium text-[11px] text-foreground'>
                    {settings.billingEnabled ? copy.status.enabled : copy.status.disabled}
                  </span>
                </div>
                <div className='flex items-baseline gap-1 whitespace-nowrap'>
                  <span className='text-[11px] text-muted-foreground'>
                    {copy.status.promoCodes}
                  </span>
                  <span className='font-medium text-[11px] text-foreground'>
                    {settings.allowPromotionCodes ? copy.status.allowed : copy.status.blocked}
                  </span>
                </div>
              </>
            ) : null}
            {settings.triggerReady ? (
              <div className='flex items-baseline gap-1 whitespace-nowrap'>
                <span className='text-[11px] text-muted-foreground'>{copy.status.triggerDev}</span>
                <span className='font-medium text-[11px] text-foreground'>
                  {settings.triggerDevEnabled ? copy.status.enabled : copy.status.disabled}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-4 bg-muted/10 px-4 py-4 sm:px-5'>
        {snapshotQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {getAdminSystemSettingsErrorMessage(copy, getErrorMessage(snapshotQuery.error))}
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <div role='status'>
            <Notice variant='success' title={copy.saved}>
              {message}
            </Notice>
          </div>
        ) : null}

        <fieldset disabled={updateMutation.isPending} className='space-y-4'>
          <legend className='sr-only'>{copy.title}</legend>
          <div className='grid gap-4 xl:grid-cols-[1.15fr_1fr]'>
            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>{copy.accessControls.title}</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {copy.accessControls.description}
                </p>
              </div>

              <div className='space-y-2'>
                <Label className='font-medium text-sm'>
                  {copy.accessControls.registrationMode}
                </Label>
                <div className='flex flex-wrap gap-2'>
                  {REGISTRATION_MODE_VALUES.map((mode) => {
                    const isActive = settings.registrationMode === mode

                    return (
                      <Button
                        key={mode}
                        type='button'
                        variant={isActive ? 'default' : 'outline'}
                        onClick={() => updateField('registrationMode', mode)}
                      >
                        {registrationCopy[mode].primary}
                      </Button>
                    )
                  })}
                </div>
              </div>

              {settings.stripeConfigured || settings.triggerReady ? (
                <div className='space-y-3 rounded-md border border-border/60 bg-muted/20 px-3 py-3'>
                  {settings.stripeConfigured ? (
                    <>
                      {!settings.billingReady ? (
                        <Alert>
                          <AlertDescription>
                            {copy.alerts.billingDisabledUntilTier}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                      <SettingSwitch
                        id='billing-enabled'
                        label={copy.accessControls.billingEnabled}
                        hint={
                          settings.billingReady
                            ? copy.accessControls.billingEnabledHint
                            : copy.accessControls.billingEnabledLocked
                        }
                        checked={settings.billingEnabled}
                        disabled={updateMutation.isPending || !settings.billingReady}
                        onCheckedChange={(checked) => updateField('billingEnabled', checked)}
                      />
                      <SettingSwitch
                        id='allow-promotion-codes'
                        label={copy.accessControls.allowPromotionCodes}
                        hint={copy.accessControls.allowPromotionCodesHint}
                        checked={settings.allowPromotionCodes}
                        disabled={updateMutation.isPending}
                        onCheckedChange={(checked) => updateField('allowPromotionCodes', checked)}
                      />
                    </>
                  ) : null}
                  {settings.triggerReady ? (
                    <SettingSwitch
                      id='trigger-dev-enabled'
                      label={copy.accessControls.triggerDevEnabled}
                      hint={copy.accessControls.triggerDevEnabledHint}
                      checked={settings.triggerDevEnabled}
                      disabled={updateMutation.isPending}
                      onCheckedChange={(checked) => updateField('triggerDevEnabled', checked)}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
              <div className='space-y-1'>
                <p className='font-medium text-sm'>{copy.emailIdentity.title}</p>
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {copy.emailIdentity.description}
                </p>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='platform-sender-domain' className='font-medium text-sm'>
                  {copy.emailIdentity.emailDomain}
                </Label>
                <Input
                  id='platform-sender-domain'
                  value={settings.emailDomain}
                  onChange={(event) => updateField('emailDomain', event.target.value)}
                  placeholder={copy.emailIdentity.emailDomainPlaceholder}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='platform-sender-identity' className='font-medium text-sm'>
                  {copy.emailIdentity.fromEmailAddress}
                </Label>
                <Input
                  id='platform-sender-identity'
                  value={settings.fromEmailAddress}
                  onChange={(event) => updateField('fromEmailAddress', event.target.value)}
                  placeholder={copy.emailIdentity.fromEmailAddressPlaceholder}
                />
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {copy.emailIdentity.helper}
                </p>
              </div>
            </div>
          </div>

          <div className='flex items-center justify-end'>
            <Button
              type='button'
              onClick={handleSave}
              disabled={updateMutation.isPending || !hasDirtyChanges}
              aria-busy={updateMutation.isPending || undefined}
            >
              {updateMutation.isPending ? copy.saving : copy.save}
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

function buildDirtyInput(
  currentSnapshot: AdminSystemSettingsSnapshot,
  nextSnapshot: AdminSystemSettingsSnapshot
) {
  const dirtyInput: Partial<AdminSystemSettingsEditableFields> = {}

  for (const field of ADMIN_SYSTEM_SETTINGS_EDITABLE_FIELDS) {
    const nextValue = nextSnapshot[field]

    if (currentSnapshot[field] !== nextValue) {
      assignDirtyField(dirtyInput, field, nextValue)
    }
  }

  return dirtyInput
}

function assignDirtyField<Key extends keyof AdminSystemSettingsEditableFields>(
  dirtyInput: Partial<AdminSystemSettingsEditableFields>,
  field: Key,
  value: AdminSystemSettingsEditableFields[Key]
) {
  dirtyInput[field] = value
}
