'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
import { getBaseUrl } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

const logger = createLogger('SSO')

const TRUSTED_SSO_PROVIDERS = [
  'okta',
  'okta-saml',
  'okta-prod',
  'okta-dev',
  'okta-staging',
  'okta-test',
  'azure-ad',
  'azure-active-directory',
  'azure-corp',
  'azure-enterprise',
  'adfs',
  'adfs-company',
  'adfs-corp',
  'adfs-enterprise',
  'auth0',
  'auth0-prod',
  'auth0-dev',
  'auth0-staging',
  'onelogin',
  'onelogin-prod',
  'onelogin-corp',
  'jumpcloud',
  'jumpcloud-prod',
  'jumpcloud-corp',
  'ping-identity',
  'ping-federate',
  'pingone',
  'shibboleth',
  'shibboleth-idp',
  'google-workspace',
  'google-sso',
  'saml',
  'saml2',
  'saml-sso',
  'oidc',
  'oidc-sso',
  'openid-connect',
  'custom-sso',
  'enterprise-sso',
  'company-sso',
]

interface SSOProvider {
  id: string
  providerId: string
  domain: string
  issuer: string
  providerType: 'oidc' | 'saml'
  hasOidcConfig: boolean
  hasSamlConfig: boolean
}

const getSsoCallbackUrl = (providerId: string, providerType: 'oidc' | 'saml') =>
  `${getBaseUrl()}/api/auth/${
    providerType === 'saml' ? 'sso/saml2/sp/acs' : 'sso/callback'
  }/${providerId}`

export function SSO() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.settingsModal.sso
  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const activeOrganization = organizationsData?.activeOrganization
  const activeOrganizationId = activeOrganization?.id
  const { data: organizationBillingData } = useOrganizationBilling(activeOrganizationId || '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [providers, setProviders] = useState<SSOProvider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(true)
  const [showConfigForm, setShowConfigForm] = useState(false)

  const [formData, setFormData] = useState({
    providerType: 'oidc' as 'oidc' | 'saml',
    providerId: '',
    issuerUrl: '',
    domain: '',
    // OIDC fields
    clientId: '',
    clientSecret: '',
    scopes: 'openid,profile,email',
    // SAML fields
    entryPoint: '',
    cert: '',
    callbackUrl: '',
    audience: '',
    wantAssertionsSigned: true,
    idpMetadata: '', // Optional IDP metadata XML
    // Advanced options
    showAdvanced: false,
  })

  const [errors, setErrors] = useState<Record<string, string[]>>({
    providerType: [],
    providerId: [],
    issuerUrl: [],
    domain: [],
    clientId: [],
    clientSecret: [],
    entryPoint: [],
    cert: [],
    scopes: [],
    callbackUrl: [],
    audience: [],
  })
  const [showErrors, setShowErrors] = useState(false)

  const userEmail = session?.user?.email
  const userRole = getUserRole(activeOrganization, userEmail)
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const organizationAccess = getOrganizationAccessState({
    billingEnabled:
      organizationBillingData?.billingEnabled ??
      organizationsData?.billingData?.data?.billingEnabled ??
      true,
    hasOrganization: Boolean(activeOrganizationId),
    isOrganizationAdmin: isOwner || isAdmin,
    organizationTier: organizationBillingData?.subscriptionTier,
  })
  const shouldFetchProviders = Boolean(activeOrganizationId && organizationAccess.canConfigureSso)

  useEffect(() => {
    let cancelled = false

    const fetchProviders = async () => {
      if (!shouldFetchProviders) {
        setProviders([])
        setProviderLoadError(null)
        setIsLoadingProviders(false)
        return
      }

      try {
        setIsLoadingProviders(true)
        const response = await fetch('/api/auth/sso/providers')
        if (!response.ok) {
          const errorData = await response.json().catch(() => null)
          throw new Error(
            errorData?.details ||
              errorData?.error ||
              response.statusText ||
              copy.providerLoadError
          )
        }

        const data = await response.json()
        if (!cancelled) {
          setProviders(data.providers || [])
          setProviderLoadError(null)
        }
      } catch (error) {
        logger.error('Failed to fetch SSO providers', { error })
        if (!cancelled) {
          setProviders([])
          setProviderLoadError(
            error instanceof Error ? error.message : copy.providerLoadError
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProviders(false)
        }
      }
    }

    fetchProviders()

    return () => {
      cancelled = true
    }
  }, [activeOrganizationId, shouldFetchProviders])

  if (!activeOrganization) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <Alert>
          <AlertDescription>
            {copy.selectOrganization}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!organizationAccess.canManageOrganization) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <Alert>
          <AlertDescription>
            {copy.onlyAdmins}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!organizationAccess.canConfigureSso) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <Alert>
          <AlertDescription>{copy.disabledTier}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const validateProviderId = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) out.push(copy.validation.providerIdRequired)
    if (!/^[-a-z0-9]+$/i.test(value.trim())) out.push(copy.validation.providerIdPattern)
    return out
  }

  const validateIssuerUrl = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) return [copy.validation.issuerUrlRequired]
    try {
      const url = new URL(value.trim())
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      if (url.protocol !== 'https:' && !isLocalhost) {
        out.push(copy.validation.issuerUrlHttps)
      }
    } catch {
      out.push(copy.validation.issuerUrlValid)
    }
    return out
  }

  const validateDomain = (value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) return [copy.validation.domainRequired]
    if (/^https?:\/\//i.test(value.trim())) out.push(copy.validation.domainNoProtocol)
    if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value.trim()))
      out.push(copy.validation.domainValid)
    return out
  }

  const validateRequired = (label: string, value: string): string[] => {
    const out: string[] = []
    if (!value || !value.trim()) out.push(formatTemplate(copy.validation.fieldRequired, { field: label }))
    return out
  }

  const validateAll = (data: typeof formData) => {
    const newErrors: Record<string, string[]> = {
      providerType: [],
      providerId: validateProviderId(data.providerId),
      issuerUrl: validateIssuerUrl(data.issuerUrl),
      domain: validateDomain(data.domain),
      clientId: [],
      clientSecret: [],
      entryPoint: [],
      cert: [],
      scopes: [],
      callbackUrl: [],
      audience: [],
    }

    if (data.providerType === 'oidc') {
      newErrors.clientId = validateRequired(copy.clientId, data.clientId)
      newErrors.clientSecret = validateRequired(copy.clientSecret, data.clientSecret)
      if (!data.scopes || !data.scopes.trim()) {
        newErrors.scopes = [copy.validation.scopesRequired]
      }
    } else if (data.providerType === 'saml') {
      newErrors.entryPoint = validateIssuerUrl(data.entryPoint || '')
      if (!newErrors.entryPoint.length && !data.entryPoint) {
        newErrors.entryPoint = [copy.validation.entryPointRequired]
      }
      newErrors.cert = validateRequired(copy.certificate, data.cert)
    }

    setErrors(newErrors)
    return newErrors
  }

  const hasAnyErrors = (errs: Record<string, string[]>) =>
    Object.values(errs).some((l) => l.length > 0)

  const isFormValid = () => {
    const requiredFields = ['providerId', 'issuerUrl', 'domain']
    const hasRequiredFields = requiredFields.every((field) => {
      const value = formData[field as keyof typeof formData]
      return typeof value === 'string' && value.trim() !== ''
    })

    if (formData.providerType === 'oidc') {
      return (
        hasRequiredFields &&
        formData.clientId.trim() !== '' &&
        formData.clientSecret.trim() !== '' &&
        formData.scopes.trim() !== ''
      )
    }
    if (formData.providerType === 'saml') {
      return hasRequiredFields && formData.entryPoint.trim() !== '' && formData.cert.trim() !== ''
    }

    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    setShowErrors(true)
    const validation = validateAll(formData)
    if (hasAnyErrors(validation)) {
      setIsLoading(false)
      return
    }

    try {
      const requestBody: any = {
        providerId: formData.providerId,
        issuer: formData.issuerUrl,
        domain: formData.domain,
        providerType: formData.providerType,
        mapping: {
          id: 'sub',
          email: 'email',
          name: 'name',
          image: 'picture',
        },
      }

      if (formData.providerType === 'oidc') {
        requestBody.clientId = formData.clientId
        requestBody.clientSecret = formData.clientSecret
        requestBody.scopes = formData.scopes.split(',').map((s) => s.trim())
      } else if (formData.providerType === 'saml') {
        requestBody.entryPoint = formData.entryPoint
        requestBody.cert = formData.cert
        requestBody.wantAssertionsSigned = formData.wantAssertionsSigned
        if (formData.callbackUrl) requestBody.callbackUrl = formData.callbackUrl
        if (formData.audience) requestBody.audience = formData.audience
        if (formData.idpMetadata) requestBody.idpMetadata = formData.idpMetadata

        requestBody.mapping = {
          id: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
          email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
          name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
        }
      }

      const response = await fetch('/api/auth/sso/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.details || errorData.error || copy.providerError)
      }

      const result = await response.json()
      logger.info('SSO provider configured', { providerId: result.providerId })

      setFormData({
        providerType: 'oidc',
        providerId: '',
        issuerUrl: '',
        domain: '',
        clientId: '',
        clientSecret: '',
        scopes: 'openid,profile,email',
        entryPoint: '',
        cert: '',
        callbackUrl: '',
        audience: '',
        wantAssertionsSigned: true,
        idpMetadata: '',
        showAdvanced: false,
      })

      const providersResponse = await fetch('/api/auth/sso/providers')
      if (!providersResponse.ok) {
        const errorData = await providersResponse.json().catch(() => null)
        throw new Error(
          errorData?.details ||
            errorData?.error ||
            providersResponse.statusText ||
            copy.reloadError
        )
      }

      const providersData = await providersResponse.json()
      setProviders(providersData.providers || [])

      setShowConfigForm(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.providerError
      setError(message)
      logger.error('Failed to configure SSO provider', { error: err })
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => {
      let processedValue: any = value

      if (field === 'wantAssertionsSigned' || field === 'showAdvanced') {
        processedValue = value === 'true'
      }

      const next = { ...prev, [field]: processedValue }

      if (field === 'providerType') {
        setShowErrors(false)
        setErrors({
          providerType: [],
          providerId: [],
          issuerUrl: [],
          domain: [],
          clientId: [],
          clientSecret: [],
          entryPoint: [],
          cert: [],
          scopes: [],
          callbackUrl: [],
          audience: [],
        })
      } else {
        validateAll(next)
      }

      return next
    })
  }

  const callbackUrl = getSsoCallbackUrl(formData.providerId, formData.providerType)

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (isLoadingProviders) {
    return <SsoSkeleton />
  }

  if (providerLoadError) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <Alert variant='destructive'>
          <AlertDescription>{providerLoadError}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const hasProviders = providers.length > 0
  const showStatus = hasProviders && !showConfigForm

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-6 pt-4 pb-4'>
        <div className='space-y-6'>
          {error && (
            <Alert variant='destructive' className='rounded-sm'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {showStatus ? (
            // SSO Provider Status View
            <div className='space-y-4'>
              {providers.map((provider) => (
                <div key={provider.id} className='rounded-lg border border-border p-6'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='flex-1'>
                      <h3 className='font-medium text-base'>{copy.providerStatus}</h3>
                      <p className='mt-1 text-muted-foreground text-sm'>
                        {provider.providerId} • {provider.domain}
                      </p>
                    </div>
                  </div>

                  <div className='mt-4 border-border border-t pt-4'>
                    <div className='grid grid-cols-2 gap-4 text-sm'>
                      <div>
                        <span className='font-medium text-muted-foreground'>{copy.issuerUrl}</span>
                        <p className='mt-1 break-all font-mono text-foreground text-xs'>
                          {provider.issuer}
                        </p>
                      </div>
                      <div>
                        <span className='font-medium text-muted-foreground'>{copy.providerId}</span>
                        <p className='mt-1 text-foreground'>{provider.providerId}</p>
                      </div>
                    </div>

                    <div className='mt-4'>
                      <span className='font-medium text-muted-foreground text-sm'>
                        {copy.callbackUrl}
                      </span>
                      <div className='relative mt-2'>
                        <Input
                          readOnly
                          value={getSsoCallbackUrl(provider.providerId, provider.providerType)}
                          className='h-9 w-full cursor-text pr-10 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary/20'
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button
                          type='button'
                          onClick={() => {
                            const url = getSsoCallbackUrl(provider.providerId, provider.providerType)
                            navigator.clipboard.writeText(url)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          }}
                          aria-label={copy.copyCallbackUrl}
                          className='-translate-y-1/2 absolute top-1/2 right-3 rounded p-1 text-muted-foreground transition hover:text-foreground'
                        >
                          {copied ? (
                            <Check className='h-4 w-4 text-green-500' />
                          ) : (
                            <Copy className='h-4 w-4' />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // SSO Configuration Form
            <>
              <form onSubmit={handleSubmit} className='space-y-3' autoComplete='off'>
                {/* Hidden dummy input to prevent autofill */}
                <input type='text' name='hidden' style={{ display: 'none' }} autoComplete='false' />
                {/* Provider Type Selection */}
                <div className='space-y-1'>
                  <Label>{copy.providerType}</Label>
                  <div className='flex rounded-md border border-input bg-background p-1'>
                    <button
                      type='button'
                      className={cn(
                        'flex-1 rounded-md px-3 py-2 font-medium text-sm transition-colors',
                        formData.providerType === 'oidc'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => handleInputChange('providerType', 'oidc')}
                    >
                      OIDC
                    </button>
                    <button
                      type='button'
                      className={cn(
                        'flex-1 rounded-md px-3 py-2 font-medium text-sm transition-colors',
                        formData.providerType === 'saml'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => handleInputChange('providerType', 'saml')}
                    >
                      SAML
                    </button>
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {formData.providerType === 'oidc'
                      ? copy.providerTypeDescriptions.oidc
                      : copy.providerTypeDescriptions.saml}
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='provider-id'>{copy.providerId}</Label>
                  <select
                    id='provider-id'
                    value={formData.providerId}
                    onChange={(e) => handleInputChange('providerId', e.target.value)}
                    className={cn(
                      'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.providerId.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  >
                    <option value=''>{copy.selectProviderId}</option>
                    {TRUSTED_SSO_PROVIDERS.map((providerId) => (
                      <option key={providerId} value={providerId}>
                        {providerId}
                      </option>
                    ))}
                  </select>
                  {showErrors && errors.providerId.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.providerId.join(' ')}</p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    {copy.selectProviderHelp}
                  </p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='issuer-url'>{copy.issuerUrl}</Label>
                  <Input
                    id='issuer-url'
                    type='url'
                    placeholder={copy.issuerUrlPlaceholder}
                    value={formData.issuerUrl}
                    name='sso_issuer_endpoint'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => e.target.removeAttribute('readOnly')}
                    onChange={(e) => handleInputChange('issuerUrl', e.target.value)}
                    className={cn(
                      'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.issuerUrl.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && errors.issuerUrl.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.issuerUrl.join(' ')}</p>
                    </div>
                  )}
                  <p className='text-muted-foreground text-xs'>{copy.issuerUrlHelp}</p>
                </div>

                <div className='space-y-1'>
                  <Label htmlFor='domain'>{copy.domain}</Label>
                  <Input
                    id='domain'
                    type='text'
                    placeholder={copy.domainPlaceholder}
                    value={formData.domain}
                    name='sso_identity_domain'
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    readOnly
                    onFocus={(e) => e.target.removeAttribute('readOnly')}
                    onChange={(e) => handleInputChange('domain', e.target.value)}
                    className={cn(
                      'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                      showErrors &&
                        errors.domain.length > 0 &&
                        'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                    )}
                  />
                  {showErrors && errors.domain.length > 0 && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{errors.domain.join(' ')}</p>
                    </div>
                  )}
                </div>

                {/* Provider-specific fields */}
                {formData.providerType === 'oidc' ? (
                  <>
                    <div className='space-y-1'>
                      <Label htmlFor='client-id'>{copy.clientId}</Label>
                      <Input
                        id='client-id'
                        type='text'
                        placeholder={copy.clientIdPlaceholder}
                        value={formData.clientId}
                        name='sso_client_identifier'
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        readOnly
                        onFocus={(e) => e.target.removeAttribute('readOnly')}
                        onChange={(e) => handleInputChange('clientId', e.target.value)}
                        className={cn(
                          'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.clientId.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.clientId.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.clientId.join(' ')}</p>
                        </div>
                      )}
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='client-secret'>{copy.clientSecret}</Label>
                      <div className='relative'>
                        <Input
                          id='client-secret'
                          type={showClientSecret ? 'text' : 'password'}
                          placeholder={copy.clientSecretPlaceholder}
                          value={formData.clientSecret}
                          name='sso_client_key'
                          autoComplete='new-password'
                          autoCapitalize='none'
                          spellCheck={false}
                          readOnly
                          onFocus={(e) => {
                            e.target.removeAttribute('readOnly')
                            setShowClientSecret(true)
                          }}
                          onBlurCapture={() => setShowClientSecret(false)}
                          onChange={(e) => handleInputChange('clientSecret', e.target.value)}
                          className={cn(
                            'rounded-md pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                            showErrors &&
                              errors.clientSecret.length > 0 &&
                              'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                          )}
                        />
                        <button
                          type='button'
                          onClick={() => setShowClientSecret((s) => !s)}
                          className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
                          aria-label={showClientSecret ? copy.hideClientSecret : copy.showClientSecret}
                        >
                          {showClientSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {showErrors && errors.clientSecret.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.clientSecret.join(' ')}</p>
                        </div>
                      )}
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='scopes'>{copy.scopes}</Label>
                      <Input
                        id='scopes'
                        type='text'
                        placeholder={copy.scopesPlaceholder}
                        value={formData.scopes}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('scopes', e.target.value)}
                        className={cn(
                          'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.scopes.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.scopes.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.scopes.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs'>
                        {copy.scopesDescription}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className='space-y-1'>
                      <Label htmlFor='entry-point'>{copy.entryPoint}</Label>
                      <Input
                        id='entry-point'
                        type='url'
                        placeholder={copy.entryPointPlaceholder}
                        value={formData.entryPoint}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('entryPoint', e.target.value)}
                        className={cn(
                          'rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.entryPoint.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                      />
                      {showErrors && errors.entryPoint.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.entryPoint.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs'>{copy.entryPointDescription}</p>
                    </div>

                    <div className='space-y-1'>
                      <Label htmlFor='cert'>{copy.certificate}</Label>
                      <textarea
                        id='cert'
                        placeholder={copy.certificatePlaceholder}
                        value={formData.cert}
                        autoComplete='off'
                        autoCapitalize='none'
                        spellCheck={false}
                        onChange={(e) => handleInputChange('cert', e.target.value)}
                        className={cn(
                          'min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                          showErrors &&
                            errors.cert.length > 0 &&
                            'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                        )}
                        rows={4}
                      />
                      {showErrors && errors.cert.length > 0 && (
                        <div className='mt-1 text-red-400 text-xs'>
                          <p>{errors.cert.join(' ')}</p>
                        </div>
                      )}
                      <p className='text-muted-foreground text-xs'>{copy.certificateDescription}</p>
                    </div>

                    {/* Advanced SAML Options */}
                    <div className='space-y-3'>
                      <button
                        type='button'
                        onClick={() =>
                          handleInputChange(
                            'showAdvanced',
                            formData.showAdvanced ? 'false' : 'true'
                          )
                        }
                        className='flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground'
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 transition-transform',
                            formData.showAdvanced && 'rotate-180'
                          )}
                        />
                        {copy.advancedOptions}
                      </button>

                      {formData.showAdvanced && (
                        <>
                          <div className='space-y-1'>
                            <Label htmlFor='audience'>{copy.audience}</Label>
                            <Input
                              id='audience'
                              type='text'
                              placeholder={copy.audiencePlaceholder}
                              value={formData.audience}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('audience', e.target.value)}
                              className='rounded-md shadow-sm'
                            />
                            <p className='text-muted-foreground text-xs'>{copy.audienceDescription}</p>
                          </div>

                          <div className='space-y-1'>
                            <Label htmlFor='callback-url'>{copy.callbackUrlOverride}</Label>
                            <Input
                              id='callback-url'
                              type='url'
                              placeholder={copy.callbackUrlPlaceholder}
                              value={formData.callbackUrl}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('callbackUrl', e.target.value)}
                              className='rounded-md shadow-sm'
                            />
                            <p className='text-muted-foreground text-xs'>{copy.callbackUrlDescription}</p>
                          </div>

                          <div className='flex items-center space-x-2'>
                            <input
                              type='checkbox'
                              id='want-assertions-signed'
                              checked={formData.wantAssertionsSigned}
                              onChange={(e) =>
                                handleInputChange(
                                  'wantAssertionsSigned',
                                  e.target.checked ? 'true' : 'false'
                                )
                              }
                              className='rounded'
                            />
                            <Label htmlFor='want-assertions-signed' className='text-sm'>
                              {copy.requireSignedAssertions}
                            </Label>
                          </div>

                          <div className='space-y-1'>
                            <Label htmlFor='idp-metadata'>{copy.metadataXml}</Label>
                            <textarea
                              id='idp-metadata'
                              placeholder={copy.metadataPlaceholder}
                              value={formData.idpMetadata}
                              autoComplete='off'
                              autoCapitalize='none'
                              spellCheck={false}
                              onChange={(e) => handleInputChange('idpMetadata', e.target.value)}
                              className='min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
                              rows={4}
                            />
                            <p className='text-muted-foreground text-xs'>{copy.metadataDescription}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                <Button
                  type='submit'
                  className='w-full rounded-md'
                  disabled={isLoading || hasAnyErrors(errors) || !isFormValid()}
                >
                  {isLoading ? copy.configuring : copy.configureProvider}
                </Button>
              </form>

              <div className='space-y-1'>
                <Label htmlFor='callback-url'>{copy.callbackUrl}</Label>
                <p className='text-muted-foreground text-xs'>
                  {copy.callbackUrlHelp}
                </p>
                <div className='relative'>
                  <Input
                    id='callback-url'
                    readOnly
                    value={callbackUrl}
                    autoComplete='off'
                    autoCapitalize='none'
                    spellCheck={false}
                    className='h-9 w-full cursor-text pr-10 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary/20'
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type='button'
                    onClick={copyCallback}
                    aria-label={copy.copyCallbackUrl}
                    className='-translate-y-1/2 absolute top-1/2 right-3 rounded p-1 text-muted-foreground transition hover:text-foreground'
                  >
                    {copied ? (
                      <Check className='h-4 w-4 text-green-500' />
                    ) : (
                      <Copy className='h-4 w-4' />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SsoSkeleton() {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto px-6 pt-4 pb-4'>
        <div className='space-y-4'>
          {/* Provider type toggle */}
          <div className='space-y-1'>
            <Skeleton className='h-4 w-28' />
            <div className='flex items-center gap-2'>
              <Skeleton className='h-9 w-20 rounded-sm' />
              <Skeleton className='h-9 w-20 rounded-sm' />
            </div>
            <Skeleton className='h-3 w-56' />
          </div>

          {/* Core fields */}
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full rounded-md' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-9 w-full rounded-md' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full rounded-md' />
            </div>
          </div>

          {/* OIDC section (client id/secret/scopes) */}
          <div className='space-y-3'>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-9 w-full rounded-md' />
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-24' />
              <div className='relative'>
                <Skeleton className='h-9 w-full rounded-md' />
                <Skeleton className='-translate-y-1/2 absolute top-1/2 right-3 h-4 w-4 rounded' />
              </div>
            </div>
            <div className='space-y-1'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full rounded-md' />
            </div>
          </div>

          {/* Submit button */}
          <Skeleton className='h-9 w-full rounded-md' />

          {/* Callback URL */}
          <div className='space-y-1'>
            <Skeleton className='h-4 w-20' />
            <div className='relative'>
              <Skeleton className='h-9 w-full rounded-md' />
              <Skeleton className='-translate-y-1/2 absolute top-1/2 right-3 h-4 w-4 rounded' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
