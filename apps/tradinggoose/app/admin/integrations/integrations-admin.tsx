'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import { useLocale } from 'next-intl'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Switch,
} from '@/components/ui'
import type {
  AdminIntegrationDefinition,
  AdminIntegrationSecret,
  AdminIntegrationsSnapshot,
} from '@/lib/admin/integrations/types'
import { getSystemIntegrationCatalogCredentialFields } from '@/lib/system-integrations/catalog'
import { AdminInlineSecretField } from '@/app/admin/admin-inline-secret-field'
import { ADMIN_META_BADGE_CLASSNAME, ADMIN_STATUS_BADGE_CLASSNAME } from '@/app/admin/badge-styles'
import { AdminPageShell } from '@/app/admin/page-shell'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  useAdminIntegrationsSnapshot,
  useSaveAdminIntegrationBundle,
} from '@/hooks/queries/admin-integrations'
import { formatTemplate, useAppMessages } from '@/i18n/client-messages'
import type { LocaleCode } from '@/i18n/utils'

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
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages().admin.integrations
  const integrationsQuery = useAdminIntegrationsSnapshot()
  const saveBundleMutation = useSaveAdminIntegrationBundle()
  const [searchTerm, setSearchTerm] = useState('')
  const [draft, setDraft] = useState<AdminIntegrationsSnapshot | null>(null)
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>({})

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

      return {
        bundle,
        bundleServices,
        secretFields,
        visibleServices,
        visibleSecretFields,
        isConfigured: isBundleConfigured(bundle.id, secretFields),
        summary: getBundleSectionSummary(copy, bundle.id, bundleServices, secretFields),
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
    { label: copy.headerStats.providers, value: String(bundles.length) },
    { label: copy.headerStats.services, value: String(services.length) },
    { label: copy.headerStats.configured, value: String(configuredBundleCount) },
  ]

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <ShieldCheck className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>{copy.title}</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder={copy.searchPlaceholder}
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
            <AlertDescription>
              {getErrorMessage(integrationsQuery.error, copy.error)}
            </AlertDescription>
          </Alert>
        ) : null}

        {saveBundleMutation.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {getErrorMessage(saveBundleMutation.error, copy.error)}
            </AlertDescription>
          </Alert>
        ) : null}

        <Alert className='border-border/60 bg-muted/20'>
          <AlertDescription>{copy.info}</AlertDescription>
        </Alert>

        {!draft && integrationsQuery.isPending ? (
          <div className='flex min-h-[280px] items-center justify-center rounded-lg border bg-background'>
            <p className='text-muted-foreground text-sm'>{copy.loading}</p>
          </div>
        ) : null}

        {draft ? (
          <div>
            {filteredBundleViews.length === 0 ? (
              <div className='flex min-h-[240px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center text-muted-foreground text-sm'>
                {copy.emptyState}
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
                                <p className='text-[11px] text-muted-foreground uppercase tracking-[0.18em]'>
                                  {copy.providerLabel}
                                </p>
                                <div className='flex flex-wrap items-center gap-2'>
                                  <h3 className='font-medium text-sm'>{bundle.displayName}</h3>
                                  <Badge variant='outline' className={ADMIN_META_BADGE_CLASSNAME}>
                                    {formatTemplate(copy.summary.serviceCount, {
                                      count: bundleServices.length,
                                      plural:
                                        bundleServices.length === 1
                                          ? ''
                                          : copy.summary.servicePlural,
                                    })}
                                  </Badge>
                                  <Badge
                                    variant='outline'
                                    className={`${ADMIN_STATUS_BADGE_CLASSNAME} ${INTEGRATION_SECTION_STATUS_BADGE_CLASSNAME[summary.status]}`}
                                  >
                                    {summary.status === 'ready'
                                      ? copy.status.ready
                                      : copy.status.review}
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
                                  <p className='font-medium text-sm'>{copy.credentials.title}</p>
                                  <p className='text-muted-foreground text-xs leading-relaxed'>
                                    {copy.credentials.description}
                                  </p>
                                </div>

                                {secretFields.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    {copy.credentials.none}
                                  </p>
                                ) : visibleSecretFields.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    {copy.credentials.noMatches}
                                  </p>
                                ) : (
                                  <div className='grid gap-3 md:grid-cols-2'>
                                    {visibleSecretFields.map((secret) => {
                                      const credentialField = getCredentialFieldConfig(
                                        bundle.id,
                                        secret.credentialKey,
                                        copy
                                      )
                                      const isSecretConfigured = hasSecretValue(secret)

                                      return (
                                        <AdminInlineSecretField
                                          key={secret.id}
                                          id={`system-config-${secret.id}`}
                                          label={credentialField.label}
                                          description={credentialField.note}
                                          hasValue={isSecretConfigured}
                                          statusClassName={ADMIN_STATUS_BADGE_CLASSNAME}
                                          isSensitive={credentialField.isSensitive}
                                          disabled={isSavingBundle}
                                          placeholder={
                                            isSecretConfigured
                                              ? formatTemplate(copy.placeholders.replaceValue, {
                                                  label: credentialField.label.toLowerCase(),
                                                })
                                              : credentialField.placeholder
                                          }
                                          onSave={(value) =>
                                            persistSecretPatch(bundle.id, secret.id, {
                                              value,
                                              hasValue: true,
                                            })
                                          }
                                          onClear={() =>
                                            persistSecretPatch(bundle.id, secret.id, {
                                              value: '',
                                              hasValue: false,
                                            })
                                          }
                                        />
                                      )
                                    })}
                                  </div>
                                )}
                              </div>

                              <div className='space-y-4 rounded-md border border-border/60 bg-background px-4 py-4'>
                                <div className='space-y-1'>
                                  <p className='font-medium text-sm'>{copy.services.title}</p>
                                  <p className='text-muted-foreground text-xs leading-relaxed'>
                                    {copy.services.description}
                                  </p>
                                </div>

                                {bundleServices.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    {copy.services.none}
                                  </p>
                                ) : visibleServices.length === 0 ? (
                                  <p className='text-muted-foreground text-sm'>
                                    {copy.services.noMatches}
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
                                              <p className='font-medium text-sm'>
                                                {service.displayName}
                                              </p>
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
                                              {formatTemplate(copy.services.inheritsFrom, {
                                                name: parent?.displayName ?? bundle.displayName,
                                              })}
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
  }

  async function persistBundleSnapshot(bundleId: string, nextSnapshot: AdminIntegrationsSnapshot) {
    const definition = nextSnapshot.definitions.find((candidate) => candidate.id === bundleId)
    if (!definition) {
      return
    }

    try {
      const serverSnapshot = await saveBundleMutation.mutateAsync({
        bundleId,
        definition,
        services: nextSnapshot.definitions.filter((candidate) => candidate.parentId === bundleId),
        secrets: nextSnapshot.secrets.filter((secret) => secret.definitionId === bundleId),
      })

      setDraft((current) =>
        current
          ? mergeBundleIntoDraft(current, serverSnapshot, bundleId)
          : cloneSnapshot(serverSnapshot)
      )
    } catch (error) {
      resetDraftToPersisted()
      throw error
    }
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

    void persistBundleSnapshot(bundleId, nextSnapshot)
  }

  function persistSecretPatch(
    bundleId: string,
    secretId: string,
    patch: { value: string; hasValue: boolean }
  ) {
    const nextSnapshot = updateDraftSnapshot((current) => ({
      ...current,
      secrets: current.secrets.map((candidate) =>
        candidate.id === secretId ? { ...candidate, ...patch } : candidate
      ),
    }))

    if (!nextSnapshot) {
      return Promise.resolve()
    }

    return persistBundleSnapshot(bundleId, nextSnapshot)
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

function getCredentialFieldConfig(
  bundleId: string,
  credentialKey: string,
  copy: ReturnType<typeof useAppMessages>['admin']['integrations']
) {
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
    note: copy.credentials.defaultDescription,
    placeholder: formatTemplate(copy.placeholders.enterValue, {
      label: credentialKey.replaceAll('_', ' '),
    }),
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
  copy: ReturnType<typeof useAppMessages>['admin']['integrations'],
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
      formatTemplate(copy.summary.serviceCount, {
        count: bundleServices.length,
        plural: bundleServices.length === 1 ? '' : copy.summary.servicePlural,
      }),
      requiredFields.length > 0
        ? formatTemplate(copy.summary.requiredCredentialsSet, {
            configured: configuredRequiredCount,
            total: requiredFields.length,
          })
        : configuredSecretCount > 0
          ? formatTemplate(copy.summary.credentialsSet, {
              count: configuredSecretCount,
              plural: configuredSecretCount === 1 ? '' : copy.summary.credentialPlural,
            })
          : copy.summary.noRequiredCredentials,
      bundleServices.length > 0
        ? formatTemplate(copy.summary.enabledCount, { count: enabledServiceCount })
        : copy.summary.noServicesAvailable,
    ]),
    missing:
      missingRequiredLabels.length > 0
        ? formatTemplate(copy.summary.missing, { labels: missingRequiredLabels.join(', ') })
        : null,
    status: missingRequiredLabels.length === 0 ? 'ready' : 'review',
  }
}

function joinSummaryParts(parts: Array<string | null>) {
  return parts.filter((part): part is string => Boolean(part)).join(' • ')
}

function getDefinitionRole(definition: AdminIntegrationDefinition) {
  return definition.parentId ? 'oauth service' : 'system-managed oauth provider'
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
