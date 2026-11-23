import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import {
  deriveSAMLIdentityProviderEntityID,
  deriveSAMLServiceProviderPolicy,
  type SAMLConfig,
} from '@better-auth/sso'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Client } from 'pg'
import { z } from 'zod'
import { assertSsoProviderIdAllowed, MAX_SSO_PROVIDER_ID_LENGTH } from '../lib/sso/provider-id'

const id = z.string().min(1)
const repairSchema = z.strictObject({
  rowId: id,
  providerId: id,
  ownerId: id,
  organizationId: id.nullable(),
  accounts: z.array(z.strictObject({ id, userId: id, accountId: id })),
  manualIdp: z.strictObject({ expectedEntityId: id.nullable(), entityId: id }).optional(),
  newProviderId: z
    .string()
    .regex(/^sso-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    .optional(),
})

type Repair = z.infer<typeof repairSchema>

function renameNativeEndpoint(
  value: string,
  oldId: string,
  newId: string,
  endpoint: 'acs' | 'slo'
) {
  const suffix = `/sso/saml2/sp/${endpoint}/${oldId}`
  return value.endsWith(suffix) ? value.slice(0, -oldId.length) + newId : value
}

function correctSaml(config: SAMLConfig, repair: Repair) {
  const { manualIdp, providerId, newProviderId } = repair
  if (manualIdp) {
    if (
      config.idpMetadata?.metadata ||
      (config.idpMetadata?.entityID ?? null) !== manualIdp.expectedEntityId
    ) {
      throw new Error('Stored manual IdP identity differs from the reviewed value')
    }
    config.idpMetadata = { ...config.idpMetadata, entityID: manualIdp.entityId }
    if (deriveSAMLIdentityProviderEntityID(config) !== manualIdp.entityId) {
      throw new Error('Native SAML parser could not confirm the reviewed IdP identity')
    }
  }
  const sp = config.spMetadata
  const requireSignatures =
    config.wantAssertionsSigned && !deriveSAMLServiceProviderPolicy(config).wantAssertionsSigned
  if (sp?.metadata && (requireSignatures || newProviderId)) {
    const doc = new DOMParser().parseFromString(sp.metadata, 'application/xml')
    const ns = 'urn:oasis:names:tc:SAML:2.0:metadata'
    const descriptors = doc.getElementsByTagNameNS(ns, 'SPSSODescriptor')
    if (
      descriptors.length !== 1 ||
      doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature').length
    ) {
      throw new Error('Automatic correction requires a single unsigned SP metadata descriptor')
    }
    if (requireSignatures) descriptors[0].setAttribute('WantAssertionsSigned', 'true')
    if (newProviderId) {
      for (const [tag, endpoint] of [
        ['AssertionConsumerService', 'acs'],
        ['SingleLogoutService', 'slo'],
      ] as const) {
        for (const node of Array.from(descriptors[0].getElementsByTagNameNS(ns, tag))) {
          for (const attribute of ['Location', 'ResponseLocation']) {
            const url = node.getAttribute(attribute)
            if (url)
              node.setAttribute(
                attribute,
                renameNativeEndpoint(url, providerId, newProviderId, endpoint)
              )
          }
        }
      }
    }
    sp.metadata = new XMLSerializer().serializeToString(doc)
    if (
      config.wantAssertionsSigned &&
      !deriveSAMLServiceProviderPolicy(config).wantAssertionsSigned
    ) {
      throw new Error('Native SAML parser still requires a signed-assertion policy correction')
    }
  }
  if (newProviderId && config.callbackUrl) {
    config.callbackUrl = renameNativeEndpoint(config.callbackUrl, providerId, newProviderId, 'acs')
  }
}

export async function repairSsoProvider(client: Client, manifest: unknown) {
  const repair = repairSchema.parse(manifest)
  const { providerId, newProviderId } = repair
  assertSsoProviderIdAllowed(newProviderId)
  if (newProviderId && providerId.length <= MAX_SSO_PROVIDER_ID_LENGTH) {
    throw new Error('Only a provider ID too long for native DNS verification may be renamed')
  }
  await client.query('BEGIN')
  try {
    await client.query('LOCK TABLE sso_provider, account, credential IN SHARE ROW EXCLUSIVE MODE')
    const { rows } = await client.query(
      'SELECT id, user_id, organization_id, saml_config FROM sso_provider WHERE provider_id = $1',
      [providerId]
    )
    const provider = rows[0]
    if (
      rows.length !== 1 ||
      provider.id !== repair.rowId ||
      provider.user_id !== repair.ownerId ||
      provider.organization_id !== repair.organizationId
    ) {
      throw new Error('The provider and ownership must match one reviewed row')
    }
    if (newProviderId && !provider.organization_id) {
      throw new Error('Renaming requires an organization-owned provider for DNS verification')
    }
    const accounts = await client.query<Repair['accounts'][number]>(
      'SELECT id, user_id AS "userId", account_id AS "accountId" FROM account WHERE provider_id = $1',
      [providerId]
    )
    const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)
    if (
      !isDeepStrictEqual(accounts.rows.sort(byId), repair.accounts.sort(byId)) ||
      new Set(accounts.rows.map((row) => row.accountId)).size !== accounts.rows.length
    ) {
      throw new Error('Linked accounts must match the reviewed unambiguous subject inventory')
    }
    if (newProviderId) {
      const used = await client.query(
        'SELECT 1 FROM sso_provider WHERE provider_id = $1 UNION ALL SELECT 1 FROM account WHERE provider_id = $1',
        [newProviderId]
      )
      if (used.rowCount) throw new Error('The new provider ID is already in use')
      await client.query(
        'UPDATE credential c SET provider_id = $2 FROM account a WHERE c.account_id = a.id AND c.provider_id = $1 AND a.provider_id = $1',
        [providerId, newProviderId]
      )
      await client.query('UPDATE account SET provider_id = $2 WHERE provider_id = $1', [
        providerId,
        newProviderId,
      ])
    }
    let samlConfig = provider.saml_config
    if (samlConfig) {
      const config: SAMLConfig = JSON.parse(samlConfig)
      correctSaml(config, repair)
      samlConfig = JSON.stringify(config)
    } else if (repair.manualIdp) {
      throw new Error('Manual IdP identity correction requires a SAML provider')
    }
    await client.query(
      `UPDATE sso_provider SET saml_config = $2, provider_id = COALESCE($3, provider_id),
       domain_verified = CASE WHEN $3::text IS NULL THEN domain_verified ELSE false END WHERE id = $1`,
      [provider.id, samlConfig, newProviderId ?? null]
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

if (import.meta.main) {
  const manifestPath = process.argv[2]
  if (!manifestPath || !process.env.DATABASE_URL) {
    throw new Error('Provide DATABASE_URL and a reviewed per-provider JSON manifest')
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await repairSsoProvider(client, manifest)
    console.log('Corrected the reviewed provider and preserved its linked account rows.')
  } finally {
    await client.end()
  }
}
