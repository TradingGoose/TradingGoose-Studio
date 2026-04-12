import { describe, expect, it } from 'vitest'
import { getOAuthCredentialFields, OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getSystemIntegrationCatalogSeedSnapshot } from './catalog'

describe('system integration catalog seed', () => {
  it('seeds built-in third-party oauth bundles, services, and secret placeholders', () => {
    const snapshot = getSystemIntegrationCatalogSeedSnapshot()

    expect(snapshot.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bundle:google',
          parentId: null,
          name: 'Google',
          isEnabled: null,
        }),
        expect.objectContaining({
          id: 'google-email',
          parentId: 'bundle:google',
          name: 'Gmail',
          isEnabled: true,
        }),
        expect.objectContaining({
          id: 'bundle:github',
          parentId: null,
          name: 'GitHub',
          isEnabled: null,
        }),
        expect.objectContaining({
          id: 'github-repo',
          parentId: 'bundle:github',
          name: 'GitHub',
          isEnabled: true,
        }),
        expect.objectContaining({
          id: 'bundle:tradier',
          parentId: null,
          name: 'Tradier',
          isEnabled: null,
        }),
        expect.objectContaining({
          id: 'tradier',
          parentId: 'bundle:tradier',
          name: 'Tradier',
          isEnabled: true,
        }),
      ])
    )

    expect(snapshot.secrets).toEqual(
      expect.arrayContaining([
        ...getOAuthCredentialFields('google').map((field) =>
          expect.objectContaining({
            id: `system-integration-secret:bundle:google:${field.key}`,
            definitionId: 'bundle:google',
            key: field.key,
            required: field.required !== false,
            value: '',
          })
        ),
        ...getOAuthCredentialFields('github').map((field) =>
          expect.objectContaining({
            id: `system-integration-secret:bundle:github:${field.key}`,
            definitionId: 'bundle:github',
            key: field.key,
            required: field.required !== false,
            value: '',
          })
        ),
      ])
    )
  })

  it('creates a child service row for every oauth service', () => {
    const snapshot = getSystemIntegrationCatalogSeedSnapshot()
    const bundleCount = snapshot.definitions.filter((definition) => !definition.parentId).length
    const serviceCount = snapshot.definitions.filter((definition) => Boolean(definition.parentId)).length
    const credentialFieldCount = snapshot.secrets.length
    const expectedServiceCount = Object.values(OAUTH_PROVIDERS).reduce(
      (count, provider) => count + Object.keys(provider.services).length,
      0
    )
    const expectedCredentialFieldCount = Object.values(OAUTH_PROVIDERS).reduce(
      (count, provider) => count + getOAuthCredentialFields(provider.id).length,
      0
    )

    expect(bundleCount).toBe(Object.keys(OAUTH_PROVIDERS).length)
    expect(serviceCount).toBe(expectedServiceCount)
    expect(credentialFieldCount).toBe(expectedCredentialFieldCount)
  })

  it('does not pre-bind tool subjects', () => {
    const snapshot = getSystemIntegrationCatalogSeedSnapshot()

    expect('bindings' in snapshot).toBe(false)
  })
})
