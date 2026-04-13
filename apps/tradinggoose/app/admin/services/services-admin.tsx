'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, KeyRound, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Switch,
} from '@/components/ui'
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components'
import type {
  AdminSystemService,
  AdminSystemServicesSnapshot,
} from '@/lib/admin/system-services/types'
import { useAdminServicesSnapshot, useSaveAdminService } from '@/hooks/queries/admin-services'

const EMPTY_SNAPSHOT: AdminSystemServicesSnapshot = {
  services: [],
}

type ServiceSectionSummary = {
  preview: string
  missing: string | null
  status: 'ready' | 'review'
}

const SERVICE_SECTION_STATUS_BADGE_CLASSNAME = {
  ready: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  review: 'bg-destructive/15 text-destructive border-destructive/20',
} as const

export function AdminServices() {
  const servicesQuery = useAdminServicesSnapshot()
  const saveServiceMutation = useSaveAdminService()
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState<AdminSystemServicesSnapshot | null>(null)
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!servicesQuery.data || draft !== null) {
      return
    }

    setDraft(structuredClone(servicesQuery.data))
  }, [draft, servicesQuery.data])

  const snapshot = draft ?? EMPTY_SNAPSHOT
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const filteredServiceViews = snapshot.services
    .map((service) => {
      if (!matchesServiceSearch(service, normalizedSearchTerm)) {
        return null
      }

      return {
        service,
        summary: getServiceSectionSummary(service),
        isConfigured: isServiceConfigured(service),
      }
    })
    .filter((serviceView) => serviceView !== null)

  const configuredCount = snapshot.services.filter((service) => isServiceConfigured(service)).length
  const reviewCount = Math.max(snapshot.services.length - configuredCount, 0)
  const headerStats = [
    { label: 'Services', value: String(snapshot.services.length) },
    { label: 'Configured', value: String(configuredCount) },
    { label: 'Review', value: String(reviewCount) },
  ]

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <KeyRound className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Admin services</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder='Search services, credentials, and settings...'
          className='w-full'
        />
      </div>
    </div>
  )

  const headerCenter = (
    <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
      {headerStats.map((stat) => (
        <div key={stat.label} className='flex items-baseline gap-1 whitespace-nowrap'>
          <span className='text-[11px] text-muted-foreground'>{stat.label}</span>
          <span className='font-medium text-[11px] text-foreground'>{stat.value}</span>
        </div>
      ))}
    </div>
  )

  return (
    <AdminPageShell left={headerLeft} center={headerCenter}>
      <div className='mx-auto flex w-full max-w-6xl flex-col gap-4'>
        {servicesQuery.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(servicesQuery.error)}</AlertDescription>
          </Alert>
        ) : null}

        {saveServiceMutation.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>{getErrorMessage(saveServiceMutation.error)}</AlertDescription>
          </Alert>
        ) : null}

        {!draft && servicesQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>Loading service catalog...</p>
          </div>
        ) : null}

        {draft ? (
          <div>
            {filteredServiceViews.length === 0 ? (
              <div className='flex min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center text-muted-foreground text-sm'>
                No services match the current search.
              </div>
            ) : (
              <div className='overflow-hidden rounded-lg border border-border bg-background'>
                {filteredServiceViews.map(({ service, summary, isConfigured }) => {
                  const isOpen =
                    normalizedSearchTerm.length > 0 ? true : Boolean(expandedServices[service.id])
                  const isSaving =
                    saveServiceMutation.isPending &&
                    saveServiceMutation.variables?.serviceId === service.id

                  return (
                    <section key={service.id} className='border-border/60 border-b last:border-b-0'>
                      <Collapsible
                        open={isOpen}
                        onOpenChange={(open) =>
                          setExpandedServices((current) => ({
                            ...current,
                            [service.id]: open,
                          }))
                        }
                      >
                        <CollapsibleTrigger asChild>
                          <Button
                            type='button'
                            variant='ghost'
                            className='flex h-auto w-full items-start justify-between gap-4 rounded-none px-4 py-4 text-left hover:bg-muted/30 sm:px-5'
                          >
                            <div className='min-w-0 flex-1 space-y-1'>
                              <div className='flex flex-wrap items-center gap-2'>
                                <h3 className='font-medium text-sm'>{service.displayName}</h3>
                                <Badge
                                  variant='outline'
                                  className={`${ADMIN_STATUS_BADGE_CLASSNAME} ${SERVICE_SECTION_STATUS_BADGE_CLASSNAME[summary.status]}`}
                                >
                                  {summary.status === 'ready' ? 'Ready' : 'Review'}
                                </Badge>
                              </div>
                              <p className='max-w-3xl text-muted-foreground text-xs leading-relaxed'>
                                {summary.preview}
                              </p>
                              {summary.missing ? (
                                <p className='max-w-3xl text-[11px] text-muted-foreground/80 leading-relaxed'>
                                  {summary.missing}
                                </p>
                              ) : null}
                            </div>
                            <div className='flex items-center pt-0.5'>
                              {isOpen ? (
                                <ChevronDown className='h-4 w-4 text-muted-foreground' />
                              ) : (
                                <ChevronRight className='h-4 w-4 text-muted-foreground' />
                              )}
                            </div>
                          </Button>
                        </CollapsibleTrigger>

                        <CollapsibleContent className='border-border/60 border-t bg-muted/10 px-4 py-4 sm:px-5'>
                          <div className='space-y-4'>
                            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                              <div className='space-y-1'>
                                <p className='font-medium text-sm'>Credentials</p>
                                <p className='text-muted-foreground text-xs leading-relaxed'>
                                  Store the runtime secrets required by this system service.
                                </p>
                              </div>

                              {service.credentials.length === 0 ? (
                                <p className='text-muted-foreground text-sm'>
                                  This service does not require stored credentials.
                                </p>
                              ) : (
                                <div className='grid gap-3 md:grid-cols-2'>
                                  {service.credentials.map((credential) => {
                                    const isFilled =
                                      credential.hasValue || Boolean(credential.value.trim())

                                    return (
                                      <div
                                        key={`${service.id}:${credential.key}`}
                                        className='rounded-md border border-border/60 bg-muted/20 p-3'
                                      >
                                        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                                          <div className='min-w-0 space-y-1'>
                                            <div className='font-medium text-sm'>
                                              {credential.label}
                                            </div>
                                            <div className='text-muted-foreground text-xs leading-relaxed'>
                                              {credential.description}
                                            </div>
                                          </div>
                                          <Badge
                                            variant={isFilled ? 'default' : 'secondary'}
                                            className={ADMIN_STATUS_BADGE_CLASSNAME}
                                          >
                                            {isFilled ? 'Configured' : 'Incomplete'}
                                          </Badge>
                                        </div>
                                        <div className='flex gap-2'>
                                          <Input
                                            type='password'
                                            value={credential.value}
                                            placeholder={
                                              credential.hasValue
                                                ? `Enter a new ${credential.label.toLowerCase()} to replace the stored value`
                                                : `Enter ${credential.label.toLowerCase()}`
                                            }
                                            onChange={(event) =>
                                              setDraft((current) =>
                                                updateCredentialDraft(
                                                  current,
                                                  service.id,
                                                  credential.key,
                                                  {
                                                    value: event.target.value,
                                                    hasValue:
                                                      credential.hasValue ||
                                                      event.target.value.trim().length > 0,
                                                  }
                                                )
                                              )
                                            }
                                            autoComplete='new-password'
                                            data-1p-ignore='true'
                                            data-lpignore='true'
                                            data-bwignore='true'
                                            data-form-type='other'
                                          />
                                          <Button
                                            type='button'
                                            variant='outline'
                                            size='icon'
                                            disabled={isSaving}
                                            onClick={() =>
                                              setDraft((current) =>
                                                updateCredentialDraft(
                                                  current,
                                                  service.id,
                                                  credential.key,
                                                  {
                                                    value: '',
                                                    hasValue: false,
                                                  }
                                                )
                                              )
                                            }
                                          >
                                            <Trash2 className='h-4 w-4' />
                                            <span className='sr-only'>
                                              Clear {credential.label}
                                            </span>
                                          </Button>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                              <div className='space-y-1'>
                                <p className='font-medium text-sm'>Settings</p>
                                <p className='text-muted-foreground text-xs leading-relaxed'>
                                  Configure runtime behavior and endpoint defaults for this service.
                                </p>
                              </div>

                              {service.settings.length === 0 ? (
                                <p className='text-muted-foreground text-sm'>
                                  This service does not expose stored settings.
                                </p>
                              ) : (
                                <div className='grid gap-3 md:grid-cols-2'>
                                  {service.settings.map((setting) => {
                                    const hasEffectiveValue =
                                      setting.hasValue || setting.defaultValue.trim().length > 0
                                    const badgeLabel = setting.hasValue
                                      ? 'Stored'
                                      : setting.defaultValue.trim().length > 0
                                        ? 'Default'
                                        : 'Optional'

                                    return (
                                      <div
                                        key={`${service.id}:${setting.key}`}
                                        className='rounded-md border border-border/60 bg-muted/20 p-3'
                                      >
                                        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                                          <div className='min-w-0 space-y-1'>
                                            <div className='font-medium text-sm'>
                                              {setting.label}
                                            </div>
                                            <div className='text-muted-foreground text-xs leading-relaxed'>
                                              {setting.description}
                                            </div>
                                          </div>
                                          <Badge
                                            variant={hasEffectiveValue ? 'outline' : 'secondary'}
                                            className={
                                              hasEffectiveValue
                                                ? ADMIN_META_BADGE_CLASSNAME
                                                : ADMIN_STATUS_BADGE_CLASSNAME
                                            }
                                          >
                                            {badgeLabel}
                                          </Badge>
                                        </div>

                                        {setting.type === 'boolean' ? (
                                          <div className='flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2'>
                                            <div className='text-muted-foreground text-xs'>
                                              {setting.hasValue
                                                ? `Stored value: ${setting.value === 'true' ? 'Enabled' : 'Disabled'}`
                                                : setting.defaultValue
                                                  ? `Default: ${setting.defaultValue === 'true' ? 'Enabled' : 'Disabled'}`
                                                  : 'Not configured'}
                                            </div>
                                            <div className='flex items-center gap-2'>
                                              <Switch
                                                checked={setting.value === 'true'}
                                                onCheckedChange={(checked) =>
                                                  setDraft((current) =>
                                                    updateSettingDraft(
                                                      current,
                                                      service.id,
                                                      setting.key,
                                                      {
                                                        value: checked ? 'true' : 'false',
                                                        hasValue: true,
                                                      }
                                                    )
                                                  )
                                                }
                                              />
                                              <Button
                                                type='button'
                                                variant='outline'
                                                size='icon'
                                                disabled={isSaving}
                                                onClick={() =>
                                                  setDraft((current) =>
                                                    updateSettingDraft(
                                                      current,
                                                      service.id,
                                                      setting.key,
                                                      {
                                                        value: '',
                                                        hasValue: false,
                                                      }
                                                    )
                                                  )
                                                }
                                              >
                                                <Trash2 className='h-4 w-4' />
                                                <span className='sr-only'>
                                                  Clear {setting.label}
                                                </span>
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className='flex gap-2'>
                                            <Input
                                              type={setting.type === 'number' ? 'number' : setting.type}
                                              value={setting.value}
                                              placeholder={
                                                setting.hasValue
                                                  ? `Enter a new ${setting.label.toLowerCase()}`
                                                  : setting.defaultValue
                                                    ? `Default: ${setting.defaultValue}`
                                                    : `Enter ${setting.label.toLowerCase()}`
                                              }
                                              onChange={(event) =>
                                                setDraft((current) =>
                                                  updateSettingDraft(
                                                    current,
                                                    service.id,
                                                    setting.key,
                                                    {
                                                      value: event.target.value,
                                                      hasValue:
                                                        setting.hasValue ||
                                                        event.target.value.trim().length > 0,
                                                    }
                                                  )
                                                )
                                              }
                                            />
                                            <Button
                                              type='button'
                                              variant='outline'
                                              size='icon'
                                              disabled={isSaving}
                                              onClick={() =>
                                                setDraft((current) =>
                                                  updateSettingDraft(
                                                    current,
                                                    service.id,
                                                    setting.key,
                                                    {
                                                      value: '',
                                                      hasValue: false,
                                                    }
                                                  )
                                                )
                                              }
                                            >
                                              <Trash2 className='h-4 w-4' />
                                              <span className='sr-only'>
                                                Clear {setting.label}
                                              </span>
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            <div className='flex items-center justify-between gap-3 border-border/60 border-t pt-2'>
                              <p className='text-muted-foreground text-xs'>
                                {isConfigured
                                  ? 'This service has everything required for runtime use.'
                                  : 'Review missing credentials or settings before saving.'}
                              </p>
                              <Button
                                type='button'
                                disabled={isSaving}
                                onClick={async () => {
                                  const nextSnapshot = await saveServiceMutation.mutateAsync({
                                    serviceId: service.id,
                                    credentials: service.credentials.map((credential) => ({
                                      key: credential.key,
                                      value: credential.value,
                                      hasValue: credential.hasValue,
                                    })),
                                    settings: service.settings.map((setting) => ({
                                      key: setting.key,
                                      value: setting.value,
                                      hasValue: setting.hasValue,
                                    })),
                                  })

                                  setDraft(structuredClone(nextSnapshot))
                                }}
                              >
                                {isSaving ? 'Saving...' : 'Save service'}
                              </Button>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AdminPageShell>
  )
}

function updateCredentialDraft(
  snapshot: AdminSystemServicesSnapshot | null,
  serviceId: string,
  key: string,
  patch: { value: string; hasValue: boolean }
) {
  if (!snapshot) {
    return snapshot
  }

  return {
    services: snapshot.services.map((service) =>
      service.id !== serviceId
        ? service
        : {
          ...service,
          credentials: service.credentials.map((credential) =>
            credential.key !== key ? credential : { ...credential, ...patch }
          ),
        }
    ),
  }
}

function updateSettingDraft(
  snapshot: AdminSystemServicesSnapshot | null,
  serviceId: string,
  key: string,
  patch: { value: string; hasValue: boolean }
) {
  if (!snapshot) {
    return snapshot
  }

  return {
    services: snapshot.services.map((service) =>
      service.id !== serviceId
        ? service
        : {
          ...service,
          settings: service.settings.map((setting) =>
            setting.key !== key ? setting : { ...setting, ...patch }
          ),
        }
    ),
  }
}

function isServiceConfigured(service: AdminSystemService) {
  const credentialsReady = service.credentials.every((credential) => credential.hasValue)
  const settingsReady = service.settings.every(
    (setting) => setting.hasValue || setting.defaultValue.trim().length > 0
  )

  return credentialsReady && settingsReady
}

function getServiceSectionSummary(service: AdminSystemService): ServiceSectionSummary {
  const configuredCredentialCount = service.credentials.filter((credential) => credential.hasValue).length
  const configuredSettingCount = service.settings.filter(
    (setting) => setting.hasValue || setting.defaultValue.trim().length > 0
  ).length
  const missingLabels = [
    ...service.credentials
      .filter((credential) => !credential.hasValue)
      .map((credential) => credential.label),
    ...service.settings
      .filter((setting) => !setting.hasValue && setting.defaultValue.trim().length === 0)
      .map((setting) => setting.label),
  ]

  return {
    preview: joinSummaryParts([
      service.description,
      `${configuredCredentialCount}/${service.credentials.length} credentials set`,
      `${configuredSettingCount}/${service.settings.length} settings resolved`,
    ]),
    missing: missingLabels.length > 0 ? `Missing ${missingLabels.join(', ')}.` : null,
    status: missingLabels.length === 0 ? 'ready' : 'review',
  }
}

function joinSummaryParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(' • ')
}

function matchesServiceSearch(service: AdminSystemService, searchTerm: string) {
  if (!searchTerm) {
    return true
  }

  return [
    service.id,
    service.displayName,
    service.description,
    ...service.credentials.flatMap((credential) => [
      credential.key,
      credential.label,
      credential.description,
    ]),
    ...service.settings.flatMap((setting) => [
      setting.key,
      setting.label,
      setting.description,
      setting.defaultValue,
      setting.type,
    ]),
  ]
    .join(' ')
    .toLowerCase()
    .includes(searchTerm)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
