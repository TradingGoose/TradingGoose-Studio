/** @vitest-environment node */
import { execFileSync } from 'node:child_process'
import dns from 'node:dns/promises'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveSAMLIdentityProviderEntityID,
  deriveSAMLServiceProviderPolicy,
  sso,
} from '@better-auth/sso'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { organization } from 'better-auth/plugins'
import type { Client } from 'pg'
import { expect, it, vi } from 'vitest'
import { repairSsoProvider } from './repair-sso-provider'

const origin = 'http://localhost:3000'
const issuer = 'https://studio.example.com'
const entryPoint = 'https://idp.example.com/login'
const entityId = 'urn:example:identity-provider'
const providerId = 'p'.repeat(45)
const newProviderId = 'sso-company'
const acs = `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`
const metadata = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${issuer}"><md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}" index="1"/></md:SPSSODescriptor></md:EntityDescriptor>`
const reviewed = {
  rowId: 'provider',
  ownerId: 'owner',
  organizationId: 'org',
  providerId,
  newProviderId,
  accounts: [],
}

function repairClient(
  owner: {
    ownerId: string
    organizationId: string | null
    accounts: { id: string; userId: string; accountId: string }[]
  },
  config: object,
  nameInUse = false
) {
  const query = vi.fn(async (statement: string, _params?: string[]) => {
    if (statement.startsWith('SELECT id, user_id, organization_id')) {
      return {
        rows: [
          {
            id: reviewed.rowId,
            user_id: owner.ownerId,
            organization_id: owner.organizationId,
            saml_config: JSON.stringify(config),
          },
        ],
      }
    }
    if (statement.startsWith('SELECT id, user_id AS')) return { rows: [...owner.accounts] }
    if (statement.startsWith('SELECT 1')) return { rowCount: Number(nameInUse) }
    return { rows: [] }
  })
  return { query, client: { query } as unknown as Client }
}

it.each([
  ['ownership', { ownerId: 'other' }, 'ownership'],
  [
    'account inventory',
    { accounts: [{ id: 'unreviewed', userId: 'other', accountId: 'unknown' }] },
    'subject inventory',
  ],
  ['manual IdP', { manualIdp: { expectedEntityId: 'other', entityId } }, 'reviewed value'],
  ['personal provider', { organizationId: null }, 'organization-owned'],
  ['occupied provider ID', {}, 'already in use'],
] as const)('rolls back a mismatched %s', async (name, overrides, error) => {
  const { client, query } = repairClient(
    { ...reviewed, organizationId: name === 'personal provider' ? null : 'org' },
    {},
    name === 'occupied provider ID'
  )
  await expect(repairSsoProvider(client, { ...reviewed, ...overrides })).rejects.toThrow(error)
  expect(query).toHaveBeenLastCalledWith('ROLLBACK')
  expect(query).not.toHaveBeenCalledWith('COMMIT')
})

it('preserves an already configured IdP when renaming a provider with generated SP metadata', async () => {
  const config = {
    issuer,
    entryPoint,
    idpMetadata: { entityID: entityId },
    wantAssertionsSigned: true,
  }
  const { client, query } = repairClient(reviewed, config)
  await repairSsoProvider(client, reviewed)
  expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE sso_provider'), [
    reviewed.rowId,
    JSON.stringify(config),
    newProviderId,
  ])
  expect(query).toHaveBeenLastCalledWith('COMMIT')
})

it('uses the repaired provider for a verified, signed SAML login by the same account', async () => {
  const tables = {
    user: [],
    session: [],
    account: [],
    verification: [],
    member: [],
    organization: [],
    invitation: [],
    ssoProvider: [],
  }
  const auth = betterAuth({
    baseURL: origin,
    secret: 'test-only-saml-signature-verification-secret',
    database: memoryAdapter(tables),
    emailAndPassword: { enabled: true },
    plugins: [
      organization(),
      sso({
        domainVerification: { enabled: true },
        saml: { allowIdpInitiated: true, idpInitiatedCallbackUrl: '/workspace' },
      }),
    ],
  })
  const email = 'linked@example.com'
  const cookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
  const signup = await auth.api.signUpEmail({
    body: { name: 'User', email, password: 'fixture-password' },
    asResponse: true,
  })
  expect(signup.status).toBe(200)
  const { user } = await signup.json()
  const { adapter, internalAdapter } = await auth.$context
  await internalAdapter.updateUser(user.id, { emailVerified: true })
  const headers = { cookie: cookie(signup), origin }
  const org = await auth.api.createOrganization({
    body: { name: 'Example', slug: 'example' },
    headers,
  })
  const link = await internalAdapter.createAccount({
    userId: user.id,
    providerId,
    accountId: email,
  })
  const owner = {
    ...reviewed,
    ownerId: user.id,
    organizationId: org!.id,
    accounts: [{ id: link.id, userId: user.id, accountId: email }],
  }

  const temp = mkdtempSync(join(tmpdir(), 'sso-signature-'))
  try {
    const keyPath = join(temp, 'key.pem')
    const certPath = join(temp, 'cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '1',
        '-subj',
        '/CN=Local SAML fixture',
      ],
      { stdio: 'ignore' }
    )
    const cert = readFileSync(certPath, 'utf8')
    const { client, query } = repairClient(owner, {
      issuer,
      entryPoint,
      cert,
      callbackUrl: acs,
      spMetadata: { metadata },
      wantAssertionsSigned: true,
    })
    await repairSsoProvider(client, { ...owner, manualIdp: { expectedEntityId: null, entityId } })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('c.account_id = a.id'), [
      providerId,
      newProviderId,
    ])
    expect(query).toHaveBeenCalledWith(
      'UPDATE account SET provider_id = $2 WHERE provider_id = $1',
      [providerId, newProviderId]
    )
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ELSE false END'), [
      reviewed.rowId,
      expect.any(String),
      newProviderId,
    ])
    expect(query).toHaveBeenLastCalledWith('COMMIT')
    const params = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE sso_provider'))![1]!
    const [, samlConfig, renamedId] = params
    const config = JSON.parse(samlConfig)
    expect(config.spMetadata.metadata).toBe(
      metadata
        .replace('WantAssertionsSigned="false"', 'WantAssertionsSigned="true"')
        .replace(providerId, newProviderId)
    )
    expect(deriveSAMLServiceProviderPolicy(config).wantAssertionsSigned).toBe(true)
    expect(deriveSAMLIdentityProviderEntityID(config)).toBe(entityId)
    expect(config.callbackUrl).toBe(acs.replace(providerId, newProviderId))
    await adapter.update({
      model: 'account',
      where: [{ field: 'id', value: link.id }],
      update: { providerId: renamedId },
    })
    await adapter.create({
      model: 'ssoProvider',
      data: {
        userId: user.id,
        organizationId: owner.organizationId,
        providerId: renamedId,
        domain: 'example.com',
        domainVerified: false,
        issuer,
        samlConfig,
      },
    })
    const sessionsBefore = tables.session.length
    const denied = await auth.api.signInSSO({
      body: { providerId: renamedId, callbackURL: '/workspace' },
      asResponse: true,
    })
    expect(denied.status).toBe(401)
    expect(tables.session).toHaveLength(sessionsBefore)
    const { domainVerificationToken } = await auth.api.requestDomainVerification({
      body: { providerId: renamedId },
      headers,
    })
    const txt = vi.spyOn(dns, 'resolveTxt').mockResolvedValue([[domainVerificationToken]])
    syncBuiltinESMExports()
    await auth.api.verifyDomain({ body: { providerId: renamedId }, headers })
    expect(txt).toHaveBeenCalledWith(`_better-auth-token-${renamedId}.example.com`)
    const require = createRequire(import.meta.url)
    const saml = createRequire(require.resolve('@better-auth/sso'))('samlify')
    const idp = saml.IdentityProvider({
      entityID: entityId,
      signingCert: cert,
      privateKey: readFileSync(keyPath, 'utf8'),
      singleSignOnService: [
        { Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect', Location: entryPoint },
      ],
    })
    const sp = saml.ServiceProvider({ metadata: config.spMetadata.metadata })
    const response = await idp.createLoginResponse(sp, { extract: {} }, 'post', { email })
    const completed = await auth.handler(
      new Request(config.callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: response.context }),
      })
    )
    expect(completed.headers.get('location')).toBe('/workspace')
    const result = await auth.api.getSession({ headers: { cookie: cookie(completed) } })
    expect(result?.user.id).toBe(user.id)
    expect(tables.member).toMatchObject([
      { organizationId: owner.organizationId, userId: user.id, role: 'owner' },
    ])
    expect(await internalAdapter.findAccounts(user.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: link.id, providerId: newProviderId, accountId: email }),
      ])
    )
    expect(tables.account).toHaveLength(2)
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    rmSync(temp, { recursive: true, force: true })
  }
})
