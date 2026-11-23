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
import * as schema from '@tradinggoose/db/schema'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization, username } from 'better-auth/plugins'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { expect, it, vi } from 'vitest'
import { repairSsoProvider } from './repair-sso-provider'

vi.unmock('pg')
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
let fixtureDatabase: NodePgDatabase<typeof schema>
vi.mock('@tradinggoose/db', async () => ({
  ...(await import('@tradinggoose/db/schema')),
  get db() {
    return fixtureDatabase
  },
}))

const databaseURL = process.env.SSO_REPAIR_TEST_DATABASE_URL

it.skipIf(!databaseURL)(
  'repairs an existing provider in place through DNS and a signed returning SAML login',
  async () => {
    const client = new Client({ connectionString: databaseURL })
    await client.connect()
    const temp = mkdtempSync(join(tmpdir(), 'sso-provider-test-'))
    try {
      // The repair and the native handler share one connection. Only its temporary tables are used.
      for (const table of [
        'user',
        'account',
        'session',
        'verification',
        'sso_provider',
        'credential',
        'organization',
        'member',
        'system_settings',
        'system_billing_settings',
      ]) {
        await client.query(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`)
      }
      const origin = 'http://localhost:3000'
      fixtureDatabase = drizzle(client, { schema })
      vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
      vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-saml-signature-verification-secret')
      const { auth: appAuth } = await import('@/lib/auth')
      const auth = betterAuth({
        baseURL: origin,
        secret: 'test-only-saml-signature-verification-secret',
        database: drizzleAdapter(fixtureDatabase, {
          provider: 'pg',
          schema,
          transaction: true,
        }),
        emailAndPassword: { enabled: true },
        hooks: { before: appAuth.options.hooks.before },
        plugins: [
          organization(),
          username({ displayUsername: false }),
          sso({
            domainVerification: { enabled: true },
            saml: { allowIdpInitiated: true, idpInitiatedCallbackUrl: '/workspace' },
          }),
        ],
      })
      const email = 'linked@example.com'
      const signup = await auth.api.signUpEmail({
        body: { name: 'User', email, password: 'fixture-password', username: 'fixtureowner' },
        asResponse: true,
      })
      expect(signup.status).toBe(200)
      const { user } = await signup.json()
      const cookie = signup.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; ')
      await (await auth.$context).internalAdapter.updateUser(user.id, { emailVerified: true })
      const headers = { cookie, origin }
      const org = await auth.api.createOrganization({
        body: { name: 'Example', slug: 'example' },
        headers,
      })
      const organizationId = org!.id
      const providerId = 'p'.repeat(45)
      const newProviderId = 'sso-company'
      const issuer = 'https://studio.example.com'
      const entryPoint = 'https://idp.example.com/login'
      const entityId = 'urn:example:identity-provider'
      const acs = `${origin}/api/auth/sso/saml2/sp/acs/${providerId}`
      const metadata = `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${issuer}"><md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}" index="1"/></md:SPSSODescriptor></md:EntityDescriptor>`
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
      const samlConfig = {
        issuer,
        entryPoint,
        cert,
        callbackUrl: acs,
        spMetadata: { metadata },
        wantAssertionsSigned: true,
      }
      await client.query(
        'INSERT INTO sso_provider (id, user_id, provider_id, domain, domain_verified, issuer, saml_config, organization_id) VALUES ($1,$2,$3,$4,true,$5,$6,$7)',
        [
          'provider-row',
          user.id,
          providerId,
          'example.com',
          issuer,
          JSON.stringify(samlConfig),
          organizationId,
        ]
      )
      const link = await (await auth.$context).internalAdapter.createAccount({
        userId: user.id,
        providerId,
        accountId: email,
      })
      await client.query(
        `INSERT INTO credential (id, workspace_id, type, display_name, provider_id, account_id, created_by)
         VALUES ('linked-credential', 'workspace', 'oauth', 'SSO', $1, $2, $3)`,
        [providerId, link.id, user.id]
      )
      const reviewed = {
        rowId: 'provider-row',
        ownerId: user.id,
        organizationId,
        providerId,
        accounts: [{ id: link.id, userId: user.id, accountId: email }],
      }

      await expect(
        repairSsoProvider(client, { ...reviewed, accounts: [], newProviderId })
      ).rejects.toThrow('subject inventory')
      await expect(
        repairSsoProvider(client, { ...reviewed, ownerId: 'another-owner', newProviderId })
      ).rejects.toThrow('ownership')
      await expect(
        repairSsoProvider(client, {
          ...reviewed,
          newProviderId,
          manualIdp: { expectedEntityId: 'another-idp', entityId },
        })
      ).rejects.toThrow('reviewed value')
      await repairSsoProvider(client, {
        ...reviewed,
        manualIdp: { expectedEntityId: null, entityId: 'urn:example:old' },
      })
      const stored = async () =>
        (await client.query('SELECT * FROM sso_provider WHERE id = $1', [reviewed.rowId])).rows[0]
      const signed = JSON.parse((await stored()).saml_config)
      expect(signed.spMetadata.metadata).toBe(
        metadata.replace('WantAssertionsSigned="false"', 'WantAssertionsSigned="true"')
      )
      expect(deriveSAMLServiceProviderPolicy(signed).wantAssertionsSigned).toBe(true)
      await repairSsoProvider(client, {
        ...reviewed,
        newProviderId,
        manualIdp: { expectedEntityId: 'urn:example:old', entityId },
      })
      const row = await stored()
      expect(
        (await client.query('SELECT id, provider_id, account_id, created_by FROM credential')).rows
      ).toEqual([
        {
          id: 'linked-credential',
          provider_id: newProviderId,
          account_id: link.id,
          created_by: user.id,
        },
      ])
      const config = JSON.parse(row.saml_config)
      expect(row).toMatchObject({
        user_id: user.id,
        organization_id: organizationId,
        provider_id: newProviderId,
        issuer,
        domain_verified: false,
      })
      expect(deriveSAMLIdentityProviderEntityID(config)).toBe(entityId)
      expect(config).toMatchObject({
        issuer,
        entryPoint,
        cert,
        callbackUrl: acs.replace(providerId, newProviderId),
      })

      const sessionsBefore = (await client.query('SELECT id FROM session')).rowCount
      const beforeVerification = await auth.api.signInSSO({
        body: { providerId: newProviderId, callbackURL: '/workspace' },
        asResponse: true,
      })
      expect(beforeVerification.status).toBe(401)
      expect((await client.query('SELECT id FROM session')).rowCount).toBe(sessionsBefore)
      await auth.api.setActiveOrganization({ body: { organizationId: null }, headers })
      for (const path of ['request-domain-verification', 'verify-domain']) {
        const withoutActiveOrganization = await auth.handler(
          new Request(`${origin}/api/auth/sso/${path}`, {
            method: 'POST',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: newProviderId }),
          })
        )
        expect(withoutActiveOrganization.status).toBe(400)
      }
      await auth.api.setActiveOrganization({ body: { organizationId }, headers })
      const { domainVerificationToken } = await auth.api.requestDomainVerification({
        body: { providerId: newProviderId },
        headers,
      })
      const txt = vi.spyOn(dns, 'resolveTxt').mockResolvedValue([[domainVerificationToken]])
      syncBuiltinESMExports()
      await auth.api.verifyDomain({ body: { providerId: newProviderId }, headers })
      expect(txt).toHaveBeenCalledWith(`_better-auth-token-${newProviderId}.example.com`)
      expect((await stored()).domain_verified).toBe(true)

      // Use the same samlify implementation as the pinned plugin to act as the fixture IdP.
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
      const result = await auth.api.getSession({
        headers: {
          cookie: completed.headers
            .getSetCookie()
            .map((v) => v.split(';')[0])
            .join('; '),
        },
      })
      expect(result?.user.id).toBe(user.id)
      expect(
        (await client.query('SELECT organization_id, user_id, role FROM member')).rows
      ).toEqual([{ organization_id: organizationId, user_id: user.id, role: 'owner' }])
      expect(await (await auth.$context).internalAdapter.findAccounts(user.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: link.id,
            providerId: newProviderId,
            accountId: email,
            userId: user.id,
          }),
        ])
      )
      expect((await client.query('SELECT id FROM account')).rowCount).toBe(2)

      const generatedId = 'g'.repeat(46)
      const generated = {
        issuer,
        entryPoint,
        cert,
        idpMetadata: { entityID: entityId },
        wantAssertionsSigned: true,
      }
      await client.query(
        'INSERT INTO sso_provider (id, user_id, provider_id, domain, issuer, saml_config, organization_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          'generated-row',
          user.id,
          generatedId,
          'example.org',
          issuer,
          JSON.stringify(generated),
          organizationId,
        ]
      )
      const metadataFor = async (id: string) =>
        (
          await auth.handler(
            new Request(`${origin}/api/auth/sso/saml2/sp/metadata?providerId=${id}`)
          )
        ).text()
      expect(await metadataFor(generatedId)).toContain(`entityID="${issuer}"`)
      const generatedRepair = {
        ...reviewed,
        rowId: 'generated-row',
        providerId: generatedId,
        accounts: [],
      }
      await expect(
        repairSsoProvider(client, { ...generatedRepair, newProviderId })
      ).rejects.toThrow('already in use')
      await repairSsoProvider(client, { ...generatedRepair, newProviderId: 'sso-generated' })
      const generatedMetadata = await metadataFor('sso-generated')
      expect(generatedMetadata).toContain(`entityID="${issuer}"`)
      expect(generatedMetadata).toContain('/sso/saml2/sp/acs/sso-generated')

      const personalId = 'x'.repeat(45)
      await client.query(
        'INSERT INTO sso_provider (id, user_id, provider_id, domain, domain_verified, issuer, saml_config) VALUES ($1,$2,$3,$4,true,$5,$6)',
        ['personal-row', user.id, personalId, 'example.org', issuer, JSON.stringify(generated)]
      )
      const personalLink = await (await auth.$context).internalAdapter.createAccount({
        userId: user.id,
        providerId: personalId,
        accountId: email,
      })
      await expect(
        repairSsoProvider(client, {
          rowId: 'personal-row',
          providerId: personalId,
          organizationId: null,
          ownerId: user.id,
          accounts: [{ id: personalLink.id, userId: user.id, accountId: email }],
          newProviderId: 'sso-personal',
        })
      ).rejects.toThrow('organization-owned provider')
      expect(
        (
          await client.query(
            'SELECT provider_id, domain_verified, organization_id FROM sso_provider WHERE id=$1',
            ['personal-row']
          )
        ).rows
      ).toEqual([{ provider_id: personalId, domain_verified: true, organization_id: null }])
      expect(
        (
          await client.query('SELECT provider_id, user_id, account_id FROM account WHERE id=$1', [
            personalLink.id,
          ])
        ).rows
      ).toEqual([{ provider_id: personalId, user_id: user.id, account_id: email }])
    } finally {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
      syncBuiltinESMExports()
      await client.end()
      rmSync(temp, { recursive: true, force: true })
    }
  }
)
