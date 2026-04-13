'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Pencil, ShieldCheck, X } from 'lucide-react'
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
import type {
  AdminIntegrationDefinition,
  AdminIntegrationSecret,
  AdminIntegrationsSnapshot,
} from '@/lib/admin/integrations/types'
import { getSystemIntegrationCatalogCredentialFields } from '@/lib/system-integrations/catalog'
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  useAdminIntegrationsSnapshot,
  useSaveAdminIntegrationBundle,
} from '@/hooks/queries/admin-integrations'

const EMPTY_SNAPSHOT: AdminIntegrationsSnapshot = {
  definitions: [],
  secrets: [],
}

type IntegrationBundleSectionSummary = {
  preview: string
  missing: string | null
  status: 'ready' | 'review'
}

const INTEGRATION_SECTION_STATUS_BADGE_CLASSNAME = {
  ready: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  review: 'bg-destructive/15 text-destructive border-destructive/20',
} as const

export function AdminIntegrations() {
  const integrationsQuery = useAdminIntegrationsSnapshot()
  const saveBundleMutation = useSaveAdminIntegrationBundle()
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState<AdminIntegrationsSnapshot | null>(null)
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({})
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
        (service) =>
          bundleMatches || matchesDefinitionSearch(service, definitions, normalizedSearchTerm)
      )

      if (
        normalizedSearchTerm &&
        !bundleMatches &&
        visibleServices.length === 0 &&
        visibleSecretFields.length === 0
      ) {
        return null
      }

      const summary = getBundleSectionSummary(bundle.id, bundleServices, secretFields)

      return {
        bundle,
        bundleServices,
        secretFields,
        visibleServices,
        visibleSecretFields,
        isConfigured: isBundleConfigured(bundle.id, secretFields),
        summary,
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
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder='Search integrations and secrets...'
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
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>Loading integration catalog...</p>
          </div>
        ) : null}

        {draft ? (
          <div>
            {filteredBundleViews.length === 0 ? (
              <div className='flex min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center text-muted-foreground text-sm'>
                No integrations match the current search.
              </div>
            ) : (
              <div className='overflow-hidden rounded-lg border border-border bg-background'>
                {filteredBundleViews.map(
                  ({
                    bundle,
                    bundleServices,
                    secretFields,
                    visibleServices,
                    visibleSecretFields,
                    isConfigured,
                    summary,
                  }) => {
                    const isOpen =
                      normalizedSearchTerm.length > 0 ? true : Boolean(expandedBundles[bundle.id])
                    const isSavingBundle =
                      saveBundleMutation.isPending &&
                      saveBundleMutation.variables?.bundleId === bundle.id

                    return (
                      <section
                        key={bundle.id}
                        className='border-border/60 border-b last:border-b-0'
                      >
                        <Collapsible
                          open={isOpen}
                          onOpenChange={(open) =>
                            setExpandedBundles((current) => ({
                              ...current,
                              [bundle.id]: open,
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
                                  <h3 className='font-medium text-sm'>{bundle.displayName}</h3>
                                  <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                                    {bundleServices.length} service
                                    {bundleServices.length === 1 ? '' : 's'}
                                  </Badge>
                                  <Badge
                                    variant='outline'
                                    className={`${ADMIN_STATUS_BADGE_CLASSNAME} ${INTEGRATION_SECTION_STATUS_BADGE_CLASSNAME[summary.status]}`}
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
                                    Set the provider secrets for this bundle.
                                  </p>
                                </div>

                                {secretFields.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    This bundle does not require stored credentials.
                                  </p>
                                ) : visibleSecretFields.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    No credentials match the current search.
                                  </p>
                                ) : (
                                  <div className='grid gap-3 md:grid-cols-2'>
                                    {visibleSecretFields.map((secret) => {
                                      const credentialField = getCredentialFieldConfig(
                                        bundle.id,
                                        secret.credentialKey
                                      )
                                      const isSecretConfigured = hasSecretValue(secret)
                                      const isEditingSecret = editingSecretId === secret.id
                                      const displayValue = isSecretConfigured
                                        ? 'Configured. Stored value hidden.'
                                        : 'Not set'

                                      return (
                                        <div
                                          key={secret.id}
                                          className='rounded-md border border-border/60 bg-muted/20 p-3'
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
                                                <div className='flex min-w-0 flex-1 items-center gap-2 rounded-md bg-background px-2 py-2'>
                                                  <Input
                                                    id={`system-config-${secret.id}`}
                                                    name={`system-config-${secret.id}`}
                                                    className='h-4 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0'
                                                    type={
                                                      credentialField.isSensitive
                                                        ? 'password'
                                                        : 'text'
                                                    }
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
                                                    placeholder={
                                                      isSecretConfigured
                                                        ? `Enter a new ${credentialField.label.toLowerCase()} to replace the stored value`
                                                        : credentialField.placeholder
                                                    }
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
                                                <div className='min-w-0 flex-1 px-3 py-2'>
                                                  <code className='block truncate font-mono text-foreground text-xs'>
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
                                )}
                              </div>

                              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                                <div className='space-y-1'>
                                  <p className='font-medium text-sm'>Services</p>
                                  <p className='text-muted-foreground text-xs leading-relaxed'>
                                    Enable or disable services in this bundle.
                                  </p>
                                </div>

                                {bundleServices.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    This bundle does not expose any services.
                                  </p>
                                ) : visibleServices.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    No services match the current search.
                                  </p>
                                ) : (
                                  <div className='space-y-3'>
                                    {visibleServices.map((service) => {
                                      const parent = service.parentId
                                        ? definitionsById.get(service.parentId)
                                        : null

                                      return (
                                        <div
                                          key={service.id}
                                          className='flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-3'
                                        >
                                          <div className='min-w-0 flex-1 space-y-1'>
                                            <div className='flex flex-wrap items-center gap-2'>
                                              <p className='font-medium text-sm'>{service.displayName}</p>
                                            </div>
                                            {hasDistinctDefinitionIdentifier(
                                              service.displayName,
                                              service.id
                                            ) ? (
                                              <div className='text-muted-foreground text-xs'>
                                                {service.id}
                                              </div>
                                            ) : null}
                                            <p className='text-muted-foreground text-xs'>
                                              Uses secrets from{' '}
                                              {parent?.displayName ?? bundle.displayName}.
                                            </p>
                                          </div>
                                          <Switch
                                            checked={Boolean(isConfigured && service.isEnabled)}
                                            disabled={!isConfigured || isSavingBundle}
                                            onCheckedChange={(checked) =>
                                              toggleDefinitionEnabled(
                                                bundle.id,
                                                service.id,
                                                checked
                                              )
                                            }
                                          />
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </section>
                    )
                  }
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AdminPageShell>
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
    setEditingSecretValue('')
  }

  function cancelEditingSecret() {
    setEditingSecretId(null)
    setEditingSecretValue('')
  }

  function saveEditingSecret(secret: AdminIntegrationSecret) {
    const nextValue = editingSecretValue.trim()
    const nextSnapshot = updateDraftSnapshot((current) => ({
      ...current,
      secrets: current.secrets.map((candidate) =>
        candidate.id === secret.id
          ? {
              ...candidate,
              value: editingSecretValue,
              hasValue: candidate.hasValue || Boolean(nextValue),
            }
          : candidate
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

  function updateDefinition(definitionId: string, updates: Partial<AdminIntegrationDefinition>) {
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

function hasSecretValue(secret: AdminIntegrationSecret) {
  return secret.hasValue || Boolean(secret.value.trim())
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
    hasValue: secret.hasValue,
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
    secrets.map((secret) => [secret.credentialKey, hasSecretValue(secret)])
  )

  return requiredFields.every((field) => Boolean(secretValuesByKey.get(field.key)))
}

function getBundleSectionSummary(
  bundleId: string,
  bundleServices: AdminIntegrationDefinition[],
  secretFields: AdminIntegrationSecret[]
): IntegrationBundleSectionSummary {
  const credentialFields = getSystemIntegrationCatalogCredentialFields(bundleId)
  const requiredFields = credentialFields.filter((field) => field.required !== false)
  const secretValuesByKey = new Map(
    secretFields.map((secret) => [secret.credentialKey, hasSecretValue(secret)])
  )
  const configuredRequiredCount = requiredFields.filter((field) =>
    Boolean(secretValuesByKey.get(field.key))
  ).length
  const configuredSecretCount = secretFields.filter((secret) => hasSecretValue(secret)).length
  const enabledServiceCount = bundleServices.filter((service) => service.isEnabled).length
  const missingRequiredLabels = requiredFields
    .filter((field) => !secretValuesByKey.get(field.key))
    .map((field) => field.label)

  return {
    preview: joinSummaryParts([
      `${bundleServices.length} service${bundleServices.length === 1 ? '' : 's'}`,
      requiredFields.length > 0
        ? `${configuredRequiredCount}/${requiredFields.length} required credentials set`
        : configuredSecretCount > 0
          ? `${configuredSecretCount} credential${configuredSecretCount === 1 ? '' : 's'} set`
          : 'No required credentials',
      bundleServices.length > 0 ? `${enabledServiceCount} enabled` : 'No services available',
    ]),
    missing:
      missingRequiredLabels.length > 0 ? `Missing ${missingRequiredLabels.join(', ')}.` : null,
    status: missingRequiredLabels.length === 0 ? 'ready' : 'review',
  }
}

function joinSummaryParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(' • ')
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
    ? (allDefinitions.find((candidate) => candidate.id === definition.parentId)?.displayName ?? '')
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

function hasDistinctDefinitionIdentifier(displayName: string, identifier: string) {
  return normalizeIdentifierValue(displayName) !== normalizeIdentifierValue(identifier)
}

function normalizeIdentifierValue(value: string) {
  return value.replaceAll(/[^a-z0-9]+/gi, '').toLowerCase()
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Something went wrong'
}
