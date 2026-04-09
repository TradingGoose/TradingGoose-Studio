'use client'

import { useEffect, useState } from 'react'
import {
  ADMIN_META_BADGE_CLASSNAME,
  ADMIN_STATUS_BADGE_CLASSNAME,
} from '@/app/admin/badge-styles'
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
import { GlobalNavbarHeader } from '@/global-navbar'
import {
  useAdminIntegrationsSnapshot,
  useSaveAdminIntegrationBundle,
} from '@/hooks/queries/admin-integrations'
import {
  type AdminIntegrationDefinition,
  type AdminIntegrationSecret,
  type AdminIntegrationsSnapshot,
} from '@/lib/admin/integrations/types'
import {
  getSystemIntegrationCatalogCredentialFields,
} from '@/lib/system-integrations/catalog'
import {
  Check,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Pencil,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'

const EMPTY_SNAPSHOT: AdminIntegrationsSnapshot = {
  definitions: [],
  secrets: [],
}

export function AdminIntegrations() {
  const integrationsQuery = useAdminIntegrationsSnapshot()
  const saveBundleMutation = useSaveAdminIntegrationBundle()
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState<AdminIntegrationsSnapshot | null>(null)
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({})
  const [revealedSecretIds, setRevealedSecretIds] = useState<Record<string, boolean>>({})
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null)
  const [editingSecretValue, setEditingSecretValue] = useState('')

  useEffect(() => {
    if (!integrationsQuery.data || draft !== null) {
      return
    }

    const nextDraft = cloneSnapshot(integrationsQuery.data)
    setDraft(nextDraft)
  }, [draft, integrationsQuery.data])

  const snapshot = draft ?? EMPTY_SNAPSHOT
  const definitions = snapshot.definitions
  const secrets = snapshot.secrets
  const bundles = definitions.filter((definition) => !definition.parentId)
  const services = definitions.filter((definition) => Boolean(definition.parentId))
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const normalizedSearchTerm = searchTerm.trim().toLowerCase()

  const filteredBundleViews = bundles
    .map((bundle) => {
      const bundleServices = services
        .filter((service) => service.parentId === bundle.id)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
      const secretFields = secrets.filter((secret) => secret.definitionId === bundle.id)
      const bundleMatches = matchesDefinitionSearch(bundle, definitions, normalizedSearchTerm)
      const visibleSecretFields = secretFields.filter(
        (secret) => bundleMatches || matchesSecretSearch(secret, normalizedSearchTerm)
      )
      const visibleServices = bundleServices.filter(
        (service) => bundleMatches || matchesDefinitionSearch(service, definitions, normalizedSearchTerm)
      )

      if (
        normalizedSearchTerm &&
        !bundleMatches &&
        visibleServices.length === 0 &&
        visibleSecretFields.length === 0
      ) {
        return null
      }

      return {
        bundle,
        bundleServices,
        visibleServices,
        visibleSecretFields,
        isConfigured: isBundleConfigured(bundle.id, secretFields),
      }
    })
    .filter((bundleView) => bundleView !== null)

  const configuredBundleCount = bundles.filter((bundle) =>
    isBundleConfigured(
      bundle.id,
      secrets.filter((secret) => secret.definitionId === bundle.id)
    )
  ).length
  const headerStats = [
    { label: 'Bundles', value: String(bundles.length) },
    { label: 'Services', value: String(services.length) },
    { label: 'Configured', value: String(configuredBundleCount) },
  ]

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <ShieldCheck className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Admin integrations</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search integrations and secrets...'
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRight = (
    <div className='flex items-center gap-2'>
      <div className='hidden items-center gap-3 rounded-md border bg-muted/20 px-3 py-1.5 xl:flex'>
        {headerStats.map((stat) => (
          <div key={stat.label} className='flex items-baseline gap-1 whitespace-nowrap'>
            <span className='text-[11px] text-muted-foreground'>
              {stat.label}
            </span>
            <span className='font-medium text-[11px] text-foreground'>{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeft} right={headerRight} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
          <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden'>
            {integrationsQuery.isError ? (
              <Alert variant='destructive'>
                <AlertDescription>{getErrorMessage(integrationsQuery.error)}</AlertDescription>
              </Alert>
            ) : null}

            {saveBundleMutation.isError ? (
              <Alert variant='destructive'>
                <AlertDescription>{getErrorMessage(saveBundleMutation.error)}</AlertDescription>
              </Alert>
            ) : null}

            {!draft && integrationsQuery.isPending ? (
              <div className='flex flex-1 items-center justify-center rounded-lg border bg-background'>
                <p className='text-muted-foreground text-sm'>Loading integration catalog...</p>
              </div>
            ) : null}

            {draft ? (
              <div className='min-h-0 flex-1 overflow-auto p-4'>
                {filteredBundleViews.length === 0 ? (
                  <div className='flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center text-muted-foreground text-sm'>
                    No integrations match the current search.
                  </div>
                ) : (
                  <div className='space-y-3'>
                    {filteredBundleViews.map(
                      ({
                        bundle,
                        bundleServices,
                        visibleServices,
                        visibleSecretFields,
                        isConfigured,
                      }) => {
                        const isOpen =
                          normalizedSearchTerm.length > 0
                            ? true
                            : Boolean(expandedBundles[bundle.id])
                        const isSavingBundle =
                          saveBundleMutation.isPending &&
                          saveBundleMutation.variables?.bundleId === bundle.id

                        return (
                          <Collapsible
                            key={bundle.id}
                            open={isOpen}
                            onOpenChange={(open) =>
                              setExpandedBundles((current) => ({
                                ...current,
                                [bundle.id]: open,
                              }))
                            }
                            className='rounded-xl border border-border/60 bg-muted/10 shadow-sm'
                          >
                            <div className='rounded-t-xl bg-muted/30 px-4 py-4'>
                              <div className='flex flex-wrap items-start justify-between gap-4'>
                                <div className='min-w-0 flex-1'>
                                  <div className='flex flex-wrap items-center gap-2'>
                                    <h3 className='font-medium text-sm'>{bundle.displayName}</h3>
                                    <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                                      {bundleServices.length} service
                                      {bundleServices.length === 1 ? '' : 's'}
                                    </Badge>
                                    <Badge
                                      variant={isConfigured ? 'default' : 'secondary'}
                                      className={ADMIN_STATUS_BADGE_CLASSNAME}
                                    >
                                      {isConfigured ? 'Configured' : 'Not set'}
                                    </Badge>
                                  </div>
                                </div>
                                <div className='flex items-center gap-2'>
                                  <CollapsibleTrigger asChild>
                                    <Button variant='ghost' size='icon' className='size-8'>
                                      <ChevronsUpDown className='h-4 w-4' />
                                      <span className='sr-only'>
                                        Toggle {bundle.displayName} services
                                      </span>
                                    </Button>
                                  </CollapsibleTrigger>
                                </div>
                              </div>

                              <div className='mt-4 grid gap-3 md:grid-cols-2'>
                                {visibleSecretFields.map((secret) => {
                                    const isRevealed = Boolean(revealedSecretIds[secret.id])
                                    const credentialField = getCredentialFieldConfig(
                                      bundle.id,
                                      secret.credentialKey
                                    )
                                    const isSecretConfigured = Boolean(secret.value.trim())
                                    const isEditingSecret = editingSecretId === secret.id
                                    const shouldMaskValue =
                                      credentialField.isSensitive && !isRevealed
                                    const displayValue = secret.value
                                      ? shouldMaskValue
                                        ? maskCredentialValue(secret.value)
                                        : secret.value
                                      : 'Not set'

                                    return (
                                      <div
                                        key={secret.id}
                                        className='rounded-lg border border-border/60 bg-background/80 p-3 shadow-sm'
                                      >
                                        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                                          <div className='flex min-w-0 items-center gap-2'>
                                            <div className='whitespace-nowrap font-medium text-sm'>
                                              {credentialField.label}
                                            </div>
                                            <div className='min-w-0 truncate text-muted-foreground text-xs'>
                                              {credentialField.note}
                                            </div>
                                          </div>
                                          <Badge
                                            variant={isSecretConfigured ? 'default' : 'secondary'}
                                            className={ADMIN_STATUS_BADGE_CLASSNAME}
                                          >
                                            {isSecretConfigured ? 'Configured' : 'Incomplete'}
                                          </Badge>
                                        </div>
                                        <div className='flex items-center gap-2'>
                                          {isEditingSecret ? (
                                            <>
                                              <Button
                                                variant='ghost'
                                                size='icon'
                                                className='h-8 w-8 text-muted-foreground'
                                                disabled={isSavingBundle}
                                                onClick={() => {
                                                  void saveEditingSecret(secret)
                                                }}
                                              >
                                                <Check className='h-4 w-4' />
                                                <span className='sr-only'>
                                                  Save {credentialField.label}
                                                </span>
                                              </Button>
                                              <div className='flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-2 py-2'>
                                                <Input
                                                  id={`system-config-${secret.id}`}
                                                  name={`system-config-${secret.id}`}
                                                  className='h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
                                                  type={credentialField.isSensitive ? 'password' : 'text'}
                                                  value={editingSecretValue}
                                                  onChange={(event) =>
                                                    setEditingSecretValue(event.target.value)
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                      event.preventDefault()
                                                      void saveEditingSecret(secret)
                                                    }

                                                    if (event.key === 'Escape') {
                                                      event.preventDefault()
                                                      cancelEditingSecret()
                                                    }
                                                  }}
                                                  placeholder={credentialField.placeholder}
                                                  autoComplete={
                                                    credentialField.isSensitive
                                                      ? 'new-password'
                                                      : 'off'
                                                  }
                                                  data-1p-ignore='true'
                                                  data-lpignore='true'
                                                  data-bwignore='true'
                                                  data-form-type='other'
                                                />
                                              </div>
                                              <Button
                                                type='button'
                                                variant='ghost'
                                                size='icon'
                                                className='h-8 w-8 text-muted-foreground'
                                                onClick={cancelEditingSecret}
                                              >
                                                <X className='h-4 w-4' />
                                                <span className='sr-only'>
                                                  Cancel editing {credentialField.label}
                                                </span>
                                              </Button>
                                            </>
                                          ) : (
                                            <>
                                              {credentialField.isSensitive ? (
                                                <Button
                                                  type='button'
                                                  variant='ghost'
                                                  size='icon'
                                                  className='h-8 w-8 text-muted-foreground'
                                                  onClick={() => {
                                                    setRevealedSecretIds((current) => ({
                                                      ...current,
                                                      [secret.id]: !current[secret.id],
                                                    }))
                                                  }}
                                                >
                                                  {isRevealed ? (
                                                    <EyeOff className='h-4 w-4' />
                                                  ) : (
                                                    <Eye className='h-4 w-4' />
                                                  )}
                                                  <span className='sr-only'>
                                                    {isRevealed ? 'Hide value' : 'Reveal value'}
                                                  </span>
                                                </Button>
                                              ) : null}
                                              <div className='min-w-0 flex-1 rounded-md bg-muted/70 px-3 py-2'>
                                                <code className='block truncate font-mono text-xs text-foreground'>
                                                  {displayValue}
                                                </code>
                                              </div>
                                              <Button
                                                type='button'
                                                variant='ghost'
                                                size='icon'
                                                className='h-8 w-8 text-muted-foreground'
                                                disabled={isSavingBundle}
                                                onClick={() => startEditingSecret(secret)}
                                              >
                                                <Pencil className='h-4 w-4' />
                                                <span className='sr-only'>
                                                  Edit {credentialField.label}
                                                </span>
                                              </Button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    )
                                  })}
                              </div>
                            </div>

                            <CollapsibleContent className='border-t border-border/60 bg-background/70'>
                              <div className='space-y-3 p-4'>
                                {visibleServices.map((service) => {
                                  const parent = service.parentId
                                    ? definitionsById.get(service.parentId)
                                    : null

                                  return (
                                    <div
                                      key={service.id}
                                      className='flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/85 px-3 py-3 shadow-sm'
                                    >
                                      <div className='min-w-0 flex-1 space-y-1'>
                                        <div className='flex flex-wrap items-center gap-2'>
                                          <p className='font-medium text-sm'>{service.displayName}</p>
                                          <Badge
                                            variant='outline'
                                            className={ADMIN_META_BADGE_CLASSNAME}
                                          >
                                            service
                                          </Badge>
                                        </div>
                                        <div className='text-muted-foreground text-xs'>
                                          {service.id}
                                        </div>
                                        <p className='text-muted-foreground text-xs'>
                                          Uses secrets from {parent?.displayName ?? bundle.displayName}.
                                        </p>
                                      </div>
                                      <Switch
                                        checked={Boolean(isConfigured && service.isEnabled)}
                                        disabled={!isConfigured || isSavingBundle}
                                        onCheckedChange={(checked) =>
                                          toggleDefinitionEnabled(bundle.id, service.id, checked)
                                        }
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )
                      }
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )

  function updateDraftSnapshot(
    transform: (current: AdminIntegrationsSnapshot) => AdminIntegrationsSnapshot
  ) {
    let nextSnapshot: AdminIntegrationsSnapshot | null = null

    setDraft((current) => {
      const base = current ?? cloneSnapshot(integrationsQuery.data ?? EMPTY_SNAPSHOT)
      nextSnapshot = transform(base)
      return nextSnapshot
    })

    return nextSnapshot
  }

  function resetDraftToPersisted() {
    setDraft(integrationsQuery.data ? cloneSnapshot(integrationsQuery.data) : null)
    cancelEditingSecret()
  }

  function persistBundleSnapshot(
    bundleId: string,
    nextSnapshot: AdminIntegrationsSnapshot,
    options?: {
      onSuccess?: () => void
      onError?: () => void
    }
  ) {
    const definition = nextSnapshot.definitions.find((candidate) => candidate.id === bundleId)
    if (!definition) {
      return
    }

    saveBundleMutation.mutate(
      {
        bundleId,
        definition,
        services: nextSnapshot.definitions.filter((candidate) => candidate.parentId === bundleId),
        secrets: nextSnapshot.secrets.filter((secret) => secret.definitionId === bundleId),
      },
      {
        onSuccess: (serverSnapshot) => {
          setDraft((current) =>
            current
              ? mergeBundleIntoDraft(current, serverSnapshot, bundleId)
              : cloneSnapshot(serverSnapshot)
          )
          options?.onSuccess?.()
        },
        onError: () => {
          resetDraftToPersisted()
          options?.onError?.()
        },
      }
    )
  }

  function startEditingSecret(secret: AdminIntegrationSecret) {
    setEditingSecretId(secret.id)
    setEditingSecretValue(secret.value)
  }

  function cancelEditingSecret() {
    setEditingSecretId(null)
    setEditingSecretValue('')
  }

  function saveEditingSecret(secret: AdminIntegrationSecret) {
    const nextSnapshot = updateDraftSnapshot((current) => ({
      ...current,
      secrets: current.secrets.map((candidate) =>
        candidate.id === secret.id ? { ...candidate, value: editingSecretValue } : candidate
      ),
    }))

    if (!nextSnapshot) {
      return
    }

    persistBundleSnapshot(secret.definitionId, nextSnapshot, {
      onSuccess: () => {
        cancelEditingSecret()
      },
    })
  }

  function updateDefinition(
    definitionId: string,
    updates: Partial<AdminIntegrationDefinition>
  ) {
    return updateDraftSnapshot((current) => ({
      ...current,
      definitions: current.definitions.map((definition) =>
        definition.id === definitionId ? { ...definition, ...updates } : definition
      ),
    }))
  }

  function toggleDefinitionEnabled(bundleId: string, definitionId: string, isEnabled: boolean) {
    const nextSnapshot = updateDefinition(definitionId, { isEnabled })
    if (!nextSnapshot) {
      return
    }

    persistBundleSnapshot(bundleId, nextSnapshot)
  }
}

function cloneSnapshot(snapshot: AdminIntegrationsSnapshot): AdminIntegrationsSnapshot {
  return {
    definitions: snapshot.definitions.map((definition) => ({ ...definition })),
    secrets: snapshot.secrets.map((secret) => ({ ...secret })),
  }
}

function maskCredentialValue(value: string) {
  if (!value) {
    return 'Not set'
  }

  const prefixLength = Math.min(3, value.length)
  const suffixLength = Math.min(2, Math.max(value.length - prefixLength, 0))
  const maskedLength = Math.max(value.length - prefixLength - suffixLength, 4)

  return `${value.slice(0, prefixLength)}${'•'.repeat(maskedLength)}${value.slice(value.length - suffixLength)}`
}

function mergeBundleIntoDraft(
  draft: AdminIntegrationsSnapshot,
  nextSnapshot: AdminIntegrationsSnapshot,
  bundleId: string
) {
  return {
    ...draft,
    definitions: [
      ...draft.definitions.filter(
        (definition) => definition.id !== bundleId && definition.parentId !== bundleId
      ),
      ...nextSnapshot.definitions
        .filter((definition) => definition.id === bundleId || definition.parentId === bundleId)
        .map((definition) => ({ ...definition })),
    ].sort(compareDefinitionsForComparison),
    secrets: [
      ...draft.secrets.filter((secret) => secret.definitionId !== bundleId),
      ...nextSnapshot.secrets
        .filter((secret) => secret.definitionId === bundleId)
        .map((secret) => ({ ...secret })),
    ].sort(compareSecretsForComparison),
  }
}

function normalizeDefinitionForComparison(definition: AdminIntegrationDefinition) {
  return {
    id: definition.id,
    parentId: definition.parentId,
    displayName: definition.displayName,
    isEnabled: definition.isEnabled,
  }
}

function compareDefinitionsForComparison(
  left: AdminIntegrationDefinition,
  right: AdminIntegrationDefinition
) {
  return (
    (left.parentId ?? '').localeCompare(right.parentId ?? '') ||
    left.id.localeCompare(right.id) ||
    left.displayName.localeCompare(right.displayName)
  )
}

function normalizeSecretForComparison(secret: AdminIntegrationSecret) {
  return {
    id: secret.id,
    definitionId: secret.definitionId,
    credentialKey: secret.credentialKey,
    value: secret.value,
  }
}

function compareSecretsForComparison(
  left: ReturnType<typeof normalizeSecretForComparison>,
  right: ReturnType<typeof normalizeSecretForComparison>
) {
  return (
    left.definitionId.localeCompare(right.definitionId) ||
    left.credentialKey.localeCompare(right.credentialKey) ||
    left.id.localeCompare(right.id) ||
    left.value.localeCompare(right.value)
  )
}

function getCredentialFieldConfig(bundleId: string, credentialKey: string) {
  const matchingField = getSystemIntegrationCatalogCredentialFields(bundleId).find(
    (field) => field.key === credentialKey
  )

  if (matchingField) {
    return matchingField
  }

  return {
    key: credentialKey,
    label: credentialKey
      .split('_')
      .filter(Boolean)
      .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
      .join(' '),
    note: 'Provider credential',
    placeholder: `Enter ${credentialKey.replaceAll('_', ' ')}`,
    isSensitive: true,
    required: true,
  }
}

function isBundleConfigured(bundleId: string, secrets: AdminIntegrationSecret[]) {
  const requiredFields = getSystemIntegrationCatalogCredentialFields(bundleId).filter(
    (field) => field.required !== false
  )

  if (requiredFields.length === 0) {
    return true
  }

  const secretValuesByKey = new Map(
    secrets.map((secret) => [secret.credentialKey, secret.value.trim()])
  )

  return requiredFields.every((field) => Boolean(secretValuesByKey.get(field.key)))
}

function getDefinitionRole(definition: AdminIntegrationDefinition) {
  return definition.parentId ? 'service' : 'bundle'
}

function matchesDefinitionSearch(
  definition: AdminIntegrationDefinition,
  allDefinitions: AdminIntegrationDefinition[],
  searchTerm: string
) {
  if (!searchTerm) {
    return true
  }

  const parentName = definition.parentId
    ? allDefinitions.find((candidate) => candidate.id === definition.parentId)?.displayName ?? ''
    : ''

  return [definition.displayName, definition.id, getDefinitionRole(definition), parentName]
    .join(' ')
    .toLowerCase()
    .includes(searchTerm)
}

function matchesSecretSearch(secret: AdminIntegrationSecret, searchTerm: string) {
  if (!searchTerm) {
    return true
  }

  return [secret.credentialKey, secret.id].join(' ').toLowerCase().includes(searchTerm)
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong'
}
